use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager, State,
};

// Store initial file path passed via CLI / OS "Open With" before frontend mounts
struct InitialFileState(Mutex<Option<String>>);

#[tauri::command]
fn get_initial_file(state: State<InitialFileState>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(InitialFileState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_initial_file])
        .setup(|app| {
            // 1. Check CLI arguments for file path (e.g. double-clicking a .txt file)
            if let Some(arg_path) = std::env::args().nth(1) {
                let path = std::path::Path::new(&arg_path);
                if path.exists() && path.is_file() {
                    let abs_path = std::fs::canonicalize(path)
                        .unwrap_or_else(|_| path.to_path_buf())
                        .to_string_lossy()
                        .to_string();
                    // Strip Windows extended-length path prefix (\\?\) if present
                    let clean_path = abs_path.strip_prefix(r"\\?\").unwrap_or(&abs_path).to_string();
                    *app.state::<InitialFileState>().0.lock().unwrap() = Some(clean_path);
                }
            }

            // 2. Build Native Menu Bar
            let new_item = MenuItemBuilder::with_id("new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::with_id("open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_item = MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Exit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .separator()
                .item(&save_item)
                .item(&save_as_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Predefined native edit actions (Undo, Redo, Cut, Copy, Paste, Select All)
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_submenu, &edit_submenu])
                .build()?;

            app.set_menu(menu)?;

            // 3. Forward menu events to the frontend
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "new" => {
                        let _ = app_handle.emit("menu-new", ());
                    }
                    "open" => {
                        let _ = app_handle.emit("menu-open", ());
                    }
                    "save" => {
                        let _ = app_handle.emit("menu-save", ());
                    }
                    "save_as" => {
                        let _ = app_handle.emit("menu-save-as", ());
                    }
                    "quit" => {
                        // Calling close() triggers frontend onCloseRequested for unsaved check
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.close();
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}