import { useState, useEffect, useCallback, useRef } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView } from "@codemirror/view"
import { Extension } from "@codemirror/state"
import { LanguageDescription } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { open, save, confirm } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import "./App.css"

const FILE_FILTERS = [
  {
    name: "Text & Code Files",
    extensions: [
      "txt",
      "md",
      "json",
      "ts",
      "tsx",
      "js",
      "jsx",
      "rs",
      "java",
      "kt",
      "py",
      "html",
      "css",
      "xml",
      "yaml",
      "yml",
      "sql",
      "sh",
      "log",
    ],
  },
  { name: "All Files", extensions: ["*"] },
]

// Common languages exposed in the status bar selector
const COMMON_LANGUAGES = [
  "Plain Text",
  "Markdown",
  "JSON",
  "TypeScript",
  "JavaScript",
  "Rust",
  "Java",
  "Kotlin",
  "Python",
  "HTML",
  "CSS",
  "SQL",
  "YAML",
  "XML",
  "Shell",
]

export default function App() {
  const [content, setContent] = useState<string>("")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 })
  const [languageName, setLanguageName] = useState<string>("Plain Text")
  const [languageExt, setLanguageExt] = useState<Extension[]>([])
  const [isDark, setIsDark] = useState<boolean>(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  )

  const fullHeightTheme = EditorView.theme({
    "&": {
      height: "100%",
    },
    ".cm-scroller": {
      height: "100%",
      overflow: "auto",
    },
    ".cm-gutters": {
      minHeight: "100%",
    },
    ".cm-content": {
      minHeight: "100%",
    },
  })

  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  // Resolve and load CodeMirror language extension by filename
  const detectLanguageByFilename = useCallback(async (filename: string | null) => {
    if (!filename) {
      setLanguageName("Plain Text")
      setLanguageExt([])
      return
    }

    const desc = LanguageDescription.matchFilename(languages, filename)
    if (desc) {
      const support = await desc.load()
      setLanguageName(desc.name)
      setLanguageExt([support])
    } else {
      setLanguageName("Plain Text")
      setLanguageExt([])
    }
  }, [])

  // Manually switch syntax highlighting from status bar
  const handleManualLanguageChange = useCallback(async (selectedName: string) => {
    if (selectedName === "Plain Text") {
      setLanguageName("Plain Text")
      setLanguageExt([])
      return
    }

    const desc = LanguageDescription.matchLanguageName(languages, selectedName, true)
    if (desc) {
      const support = await desc.load()
      setLanguageName(desc.name)
      setLanguageExt([support])
    }
  }, [])

  // Listen to OS dark/light theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Synchronise native window title
  useEffect(() => {
    const fileName = filePath ? filePath.split(/[/\\]/).pop() : "Untitled"
    const prefix = isDirty ? "*" : ""
    getCurrentWindow().setTitle(`${prefix}${fileName} - Tauri Notepad`)
  }, [filePath, isDirty])

  // Helper to load a file from disk and apply syntax highlighting
  const loadFileFromPath = useCallback(
    async (targetPath: string) => {
      const text = await readTextFile(targetPath)
      setContent(text)
      setFilePath(targetPath)
      setIsDirty(false)
      await detectLanguageByFilename(targetPath)
    },
    [detectLanguageByFilename]
  )

  // Check initial CLI file argument or runtime open-file events
  useEffect(() => {
    invoke<string | null>("get_initial_file").then((initialPath) => {
      if (initialPath) {
        loadFileFromPath(initialPath)
      }
    })

    const unlistenOpenFile = listen<string>("open-file", (event) => {
      if (event.payload) {
        loadFileFromPath(event.payload)
      }
    })

    return () => {
      unlistenOpenFile.then((fn) => fn())
    }
  }, [loadFileFromPath])

  // Intercept window close when unsaved
  useEffect(() => {
    const appWindow = getCurrentWindow()
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      if (isDirtyRef.current) {
        event.preventDefault()

        const confirmed = await confirm(
          "You have unsaved changes. Are you sure you want to exit?",
          { title: "Unsaved Changes", kind: "warning" }
        )

        if (confirmed) {
          isDirtyRef.current = false
          setTimeout(() => {
            appWindow.destroy()
          }, 0)
        }
      }
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  // Menu Actions
  const handleNew = useCallback(async () => {
    if (isDirtyRef.current) {
      const confirmed = await confirm("Discard current unsaved changes and create a new file?", {
        title: "Confirm",
        kind: "warning",
      })
      if (!confirmed) return
    }
    setContent("")
    setFilePath(null)
    setIsDirty(false)
    setLanguageName("Plain Text")
    setLanguageExt([])
  }, [])

  const handleOpen = useCallback(async () => {
    if (isDirtyRef.current) {
      const confirmed = await confirm("Discard current unsaved changes and open another file?", {
        title: "Confirm",
        kind: "warning",
      })
      if (!confirmed) return
    }

    const selected = await open({
      multiple: false,
      filters: FILE_FILTERS,
    })

    if (typeof selected === "string") {
      await loadFileFromPath(selected)
    }
  }, [loadFileFromPath])

  const handleSaveAs = useCallback(async () => {
    const targetPath = await save({ filters: FILE_FILTERS })
    if (!targetPath) return

    await writeTextFile(targetPath, content)
    setFilePath(targetPath)
    setIsDirty(false)
    // Re-detect language in case user saved as .ts / .rs / .json etc.
    await detectLanguageByFilename(targetPath)
  }, [content, detectLanguageByFilename])

  const handleSave = useCallback(async () => {
    if (!filePath) {
      await handleSaveAs()
      return
    }
    await writeTextFile(filePath, content)
    setIsDirty(false)
  }, [filePath, content, handleSaveAs])

  // Subscribe to Rust Native Menu events
  useEffect(() => {
    const unlisteners = [
      listen("menu-new", handleNew),
      listen("menu-open", handleOpen),
      listen("menu-save", handleSave),
      listen("menu-save-as", handleSaveAs),
    ]

    return () => {
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [handleNew, handleOpen, handleSave, handleSaveAs])

  // Subscribe to Rust Native Menu events
  useEffect(() => {
    const unlisteners = [
      listen("menu-new", handleNew),
      listen("menu-open", handleOpen),
      listen("menu-save", handleSave),
      listen("menu-save-as", handleSaveAs),
    ]

    return () => {
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
    }
  }, [handleNew, handleOpen, handleSave, handleSaveAs])

  // Fallback keyboard shortcuts when focus is inside WebView2 / CodeMirror
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault()
          handleNew()
          break
        case "o":
          e.preventDefault()
          handleOpen()
          break
        case "s":
          e.preventDefault()
          if (e.shiftKey) {
            handleSaveAs()
          } else {
            handleSave()
          }
          break
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [handleNew, handleOpen, handleSave, handleSaveAs])

  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
    setIsDirty(true)
  }, [])

  // Ensure current detected language (e.g. "C++" or "Go") appears in dropdown even if not in COMMON_LANGUAGES
  const dropdownOptions = COMMON_LANGUAGES.includes(languageName)
    ? COMMON_LANGUAGES
    : [languageName, ...COMMON_LANGUAGES]

  return (
    <div className="notepad-container">
      <div className="editor-wrapper">
        <CodeMirror
          value={content}
          height="100%"
          theme={isDark ? "dark" : "light"}
          extensions={[EditorView.lineWrapping, fullHeightTheme, ...languageExt]}
          onChange={handleEditorChange}
          onUpdate={(viewUpdate) => {
            if (viewUpdate.selectionSet) {
              const pos = viewUpdate.state.selection.main.head
              const line = viewUpdate.state.doc.lineAt(pos)
              setCursorInfo({
                line: line.number,
                col: pos - line.from + 1,
              })
            }
          }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            history: true,
          }}
        />
      </div>

      <footer className="statusbar">
        <span className="file-path">{filePath ?? "Untitled"}</span>
        <div className="status-right">
          <span>
            Ln {cursorInfo.line}, Col {cursorInfo.col}
          </span>
          <span className="separator">|</span>
          <span>Chars: {content.length}</span>
          <span className="separator">|</span>
          <select
            className="language-select"
            value={languageName}
            onChange={(e) => handleManualLanguageChange(e.target.value)}
            title="Select Syntax Highlighting">
            {dropdownOptions.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      </footer>
    </div>
  )
}
