#[cfg(debug_assertions)]
mod motion_diagnostics;
mod agent_protocol;
mod backend;
mod llm;
mod local_agent;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(DesktopPetPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
fn make_visible_on_every_space(
    window: tauri::WebviewWindow,
    accepts_keyboard_input: bool,
) -> Result<(), String> {
    let panel = window
        .to_panel::<DesktopPetPanel>()
        .map_err(|error| format!("将窗口转换为 macOS NSPanel 失败：{error}"))?;

    // Keyboard focus may reorder windows within a level. Keep the one real
    // cat in a permanently higher band than its chat dock, without making the
    // cat key or preventing the chat composer from receiving keyboard input.
    let level = PanelLevel::Floating.value() + if window.label() == "main" { 1 } else { 0 };
    panel.set_level(level);
    let style_mask = if accepts_keyboard_input {
        StyleMask::empty().borderless()
    } else {
        StyleMask::empty().borderless().nonactivating_panel()
    };
    panel.set_style_mask(style_mask.into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .ignores_cycle()
            .into(),
    );
    // Finder becomes active again immediately after launching an accessory
    // application. Keep the desktop-pet panel visible across that focus change.
    panel.set_hides_on_deactivate(false);

    Ok(())
}

const WINDOW_EDGE_MARGIN: f64 = 24.0;
const PET_BOTTOM_MARGIN: f64 = 80.0;
const PET_POSITION_FILE: &str = "pet-position.json";
const PET_LEGACY_CLOSED_WIDTH: f64 = 184.0;
const PET_LEGACY_CLOSED_HEIGHT: f64 = 300.0;
// The closed state is the exact right-bottom crop of the compact reference:
// source [1128, 48, 1672, 941] at the standard Retina 2× scale.
const PET_CLOSED_WIDTH: f64 = 232.0;
const PET_CLOSED_HEIGHT: f64 = 380.9;
// The compact state uses the same 1672 × 941 reference canvas as the closed
// cat, uniformly scaled to 0.852941 in CSS. The native surface is therefore
// 713 × 401 logical pixels and the cat keeps the exact closed-state scale.
const PET_CHAT_EXPANDED_WIDTH: f64 = 940.0;
const PET_CHAT_EXPANDED_HEIGHT: f64 = 760.0;

#[derive(Debug, Deserialize, Serialize)]
struct StoredPetPosition {
    x: i32,
    y: i32,
    #[serde(default)]
    version: u8,
}

fn physical_pixels(logical_pixels: f64, scale_factor: f64) -> i32 {
    (logical_pixels * scale_factor).round() as i32
}

fn physical_window_pixels(logical_pixels: f64, scale_factor: f64) -> i32 {
    (logical_pixels.ceil() * scale_factor).round() as i32
}

fn position_pet_at_default(app: &AppHandle) -> Result<PhysicalPosition<i32>, String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let monitor = pet
        .primary_monitor()
        .map_err(|error| format!("无法获取主屏幕：{error}"))?
        .ok_or_else(|| "未检测到主屏幕".to_owned())?;
    let pet_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let right_margin = physical_pixels(WINDOW_EDGE_MARGIN, monitor.scale_factor());
    let bottom_margin = physical_pixels(PET_BOTTOM_MARGIN, monitor.scale_factor());
    let x = monitor_position.x + monitor_size.width as i32 - pet_size.width as i32 - right_margin;
    let y =
        monitor_position.y + monitor_size.height as i32 - pet_size.height as i32 - bottom_margin;

    let position = PhysicalPosition::new(x, y);
    pet.set_position(position)
        .map_err(|error| format!("无法设置桌宠位置：{error}"))?;
    Ok(position)
}

fn position_pet_at_bottom_right(app: &AppHandle) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let monitor = pet
        .primary_monitor()
        .map_err(|error| format!("无法获取主屏幕：{error}"))?
        .ok_or_else(|| "未检测到主屏幕".to_owned())?;
    let pet_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;

    if let Some(saved) = load_pet_position(app) {
        let (saved_x, saved_y) = if saved.version >= 2 {
            (
                saved.x - pet_size.width as i32,
                saved.y - pet_size.height as i32,
            )
        } else {
            // Version 1 stored the old 184×300 closed window's top-left.
            // Convert it once to the same bottom-right anchor used by v2.
            (
                saved.x + physical_pixels(PET_LEGACY_CLOSED_WIDTH, monitor.scale_factor())
                    - pet_size.width as i32,
                saved.y + physical_pixels(PET_LEGACY_CLOSED_HEIGHT, monitor.scale_factor())
                    - pet_size.height as i32,
            )
        };
        let monitors = pet
            .available_monitors()
            .map_err(|error| format!("无法获取屏幕列表：{error}"))?;
        let minimum_visible = physical_pixels(64.0, monitor.scale_factor());
        let is_visible = monitors.iter().any(|candidate| {
            let position = candidate.position();
            let size = candidate.size();
            let right = position.x + size.width as i32;
            let bottom = position.y + size.height as i32;
            saved_x < right - minimum_visible
                && saved_x + pet_size.width as i32 > position.x + minimum_visible
                && saved_y < bottom - minimum_visible
                && saved_y + pet_size.height as i32 > position.y + minimum_visible
        });
        if is_visible {
            return pet
                .set_position(PhysicalPosition::new(saved_x, saved_y))
                .map_err(|error| format!("无法恢复桌宠位置：{error}"));
        }
    }

    position_pet_at_default(app).map(|_| ())
}

fn pet_position_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PET_POSITION_FILE))
        .map_err(|error| format!("无法确定桌宠配置目录：{error}"))
}

fn load_pet_position(app: &AppHandle) -> Option<StoredPetPosition> {
    let bytes = std::fs::read(pet_position_path(app).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
fn save_pet_position(app: AppHandle, mut position: StoredPetPosition) -> Result<(), String> {
    let pet = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠窗口".to_owned())?;
    let current_size = pet
        .outer_size()
        .map_err(|error| format!("无法获取桌宠尺寸：{error}"))?;
    position.x += current_size.width as i32;
    position.y += current_size.height as i32;
    position.version = 2;

    let path = pet_position_path(&app)?;
    let directory = path.parent().ok_or_else(|| "桌宠配置目录无效".to_owned())?;
    std::fs::create_dir_all(directory).map_err(|error| format!("创建桌宠配置目录失败：{error}"))?;
    let bytes =
        serde_json::to_vec(&position).map_err(|error| format!("序列化桌宠位置失败：{error}"))?;
    std::fs::write(path, bytes).map_err(|error| format!("保存桌宠位置失败：{error}"))
}

#[tauri::command]
fn reset_pet_position(app: AppHandle) -> Result<(), String> {
    let origin = pet_drag_origin(app.clone(), app.get_webview_window("main").ok_or("找不到桌宠窗口")?, "reset".to_owned())?;
    let position = position_pet_at_default(&app)?;
    // Reset moves both windows by the same physical delta, independently of
    // AppKit parent/child relations (which hide/order operations can change).
    if let Some(chat) = app.get_webview_window("chat") {
        chat.set_position(PhysicalPosition::new(
            origin.chat_x + position.x - origin.main_x,
            origin.chat_y + position.y - origin.main_y,
        )).map_err(|error| error.to_string())?;
    }

    // Persist the reset immediately. The normal onMoved debounce will also
    // observe this move, but the command must use the calculated destination
    // because AppKit can briefly return the previous position after setPosition.
    save_pet_position(
        app,
        StoredPetPosition {
            x: position.x,
            y: position.y,
            version: 0,
        },
    )
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[derive(Clone, Copy, Default, Deserialize)]
struct ChatHitBounds { x: f64, y: f64, width: f64, height: f64 }
#[derive(Default)]
struct ChatHitState {
    bounds: Mutex<ChatHitBounds>,
    visible: AtomicBool,
    dragging: AtomicBool,
    poll_pending: AtomicBool,
    drag_id: Mutex<String>,
}

#[cfg(target_os = "macos")]
fn update_chat_pointer_policy(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ChatHitState>();
    let panel = app.get_webview_panel("chat").map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
    let bounds = *state.bounds.lock().map_err(|_| "聊天命中区域不可用")?;
    let accepts = if !state.visible.load(Ordering::Relaxed) { false }
        else if state.dragging.load(Ordering::Relaxed) { true }
        else {
            unsafe {
                let mouse: tauri_nspanel::NSPoint = tauri_nspanel::objc2::msg_send![tauri_nspanel::objc2::class!(NSEvent), mouseLocation];
                let frame: tauri_nspanel::NSRect = tauri_nspanel::objc2::msg_send![panel.as_panel(), frame];
                let x = mouse.x - frame.origin.x;
                let y = frame.origin.y + frame.size.height - mouse.y;
                x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
            }
        };
    panel.set_ignores_mouse_events(!accepts);
    Ok(())
}

#[tauri::command]
fn set_chat_hit_bounds(app: AppHandle, window: tauri::WebviewWindow, bounds: ChatHitBounds) -> Result<(), String> {
    if window.label() != "chat" { return Err("仅聊天窗口可更新命中区域".to_owned()); }
    if ![bounds.x, bounds.y, bounds.width, bounds.height].iter().all(|value| value.is_finite()) {
        return Err("聊天命中区域无效".to_owned());
    }
    let x = bounds.x.clamp(0.0, 940.0);
    let y = bounds.y.clamp(0.0, 760.0);
    *app.state::<ChatHitState>().bounds.lock().map_err(|_| "聊天命中区域不可用")? = ChatHitBounds {
        x, y, width: bounds.width.clamp(0.0, 940.0 - x), height: bounds.height.clamp(0.0, 760.0 - y),
    };
    #[cfg(target_os = "macos")]
    update_chat_pointer_policy(&app)?;
    Ok(())
}

#[tauri::command]
fn end_pet_group_drag(app: AppHandle, drag_id: String) -> Result<(), String> {
    let state = app.state::<ChatHitState>();
    if *state.drag_id.lock().map_err(|_| "拖动状态不可用")? == drag_id {
        state.dragging.store(false, Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        update_chat_pointer_policy(&app)?;
    }
    Ok(())
}

// Only the chat surface changes size. The cat's transparent backing is fixed.
#[tauri::command]
fn set_pet_chat_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let pet = app.get_webview_window("main").ok_or("找不到桌宠窗口")?;
    let chat = app.get_webview_window("chat").ok_or("找不到聊天窗口")?;
    if mode == "closed" {
        let state = app.state::<ChatHitState>();
        state.visible.store(false, Ordering::Relaxed);
        state.dragging.store(false, Ordering::Relaxed);
        #[cfg(target_os = "macos")]
        update_chat_pointer_policy(&app)?;
        return chat.hide().map_err(|error| format!("无法隐藏聊天窗口：{error}"));
    }
    if mode != "compact" && mode != "expanded" { return Err(format!("不支持的桌宠对话模式：{mode}")); }
    #[cfg(target_os = "macos")]
    let (width, height) = (PET_CHAT_EXPANDED_WIDTH, PET_CHAT_EXPANDED_HEIGHT);
    #[cfg(not(target_os = "macos"))]
    let (width, height) = if mode == "compact" { (713.0, 401.0) } else { (940.0, 760.0) };
    let scale = pet.scale_factor().map_err(|error| error.to_string())?;
    let position = pet.outer_position().map_err(|error| error.to_string())?;
    let size = pet.outer_size().map_err(|error| error.to_string())?;
    let x = position.x + size.width as i32 - physical_window_pixels(width, scale);
    let y = position.y + size.height as i32 - physical_window_pixels(height, scale);
    #[cfg(target_os = "macos")]
    {
        let primary = pet.primary_monitor().map_err(|error| error.to_string())?.ok_or("未检测到主屏幕")?;
        let primary_height = primary.size().height as f64 / primary.scale_factor();
        let frame = tauri_nspanel::NSRect::new(
            tauri_nspanel::NSPoint::new(x as f64 / scale, primary_height - y as f64 / scale - height),
            tauri_nspanel::NSSize::new(width, height),
        );
        let panel = app.get_webview_panel("chat").map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
        // Native dimensions are fixed in configuration. Reposition only when
        // reopening after the cat moved, never resize a visible backing.
        unsafe { let _: () = tauri_nspanel::objc2::msg_send![panel.as_panel(), setFrameOrigin: frame.origin]; }
    }
    #[cfg(not(target_os = "macos"))]
    {
        chat.set_size(LogicalSize::new(width, height)).map_err(|error| error.to_string())?;
        chat.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn make_visible_on_every_space(
    _window: tauri::WebviewWindow,
    _accepts_keyboard_input: bool,
) -> Result<(), String> {
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
struct PetDragOrigin {
    main_x: i32,
    main_y: i32,
    chat_x: i32,
    chat_y: i32,
    scale: f64,
}

#[tauri::command]
fn pet_drag_origin(app: AppHandle, window: tauri::WebviewWindow, drag_id: String) -> Result<PetDragOrigin, String> {
    *app.state::<ChatHitState>().drag_id.lock().map_err(|_| "拖动状态不可用")? = drag_id;
    app.state::<ChatHitState>().dragging.store(window.label() == "chat", Ordering::Relaxed);
    let main = app.get_webview_window("main").ok_or("找不到桌宠窗口")?;
    let chat = app.get_webview_window("chat").ok_or("找不到聊天窗口")?;
    let a = main.outer_position().map_err(|error| error.to_string())?;
    let b = chat.outer_position().map_err(|error| error.to_string())?;
    Ok(PetDragOrigin { main_x: a.x, main_y: a.y, chat_x: b.x, chat_y: b.y,
        scale: main.scale_factor().map_err(|error| error.to_string())? })
}

#[tauri::command]
async fn move_pet_group(app: AppHandle, origin: PetDragOrigin, delta_x: f64, delta_y: f64) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let current = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(move_pet_group_on_main(current, origin, delta_x, delta_y));
    }).map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "拖动窗口操作未完成".to_owned())?
}

fn move_pet_group_on_main(app: AppHandle, origin: PetDragOrigin, delta_x: f64, delta_y: f64) -> Result<(), String> {
    if !delta_x.is_finite() || !delta_y.is_finite() || !origin.scale.is_finite() || origin.scale <= 0.0 {
        return Err("拖动坐标无效".to_owned());
    }
    let dx = (delta_x * origin.scale).round() as i32;
    let dy = (delta_y * origin.scale).round() as i32;
    // Both origins are from one pointer-down; no move operation resizes a view.
    for (label, x, y) in [("main", origin.main_x + dx, origin.main_y + dy), ("chat", origin.chat_x + dx, origin.chat_y + dy)] {
        let window = app.get_webview_window(label).ok_or("找不到桌宠窗口")?;
        #[cfg(target_os = "macos")]
        {
            let panel = app.get_webview_panel(label).map_err(|error| format!("无法获取面板：{error:?}"))?;
            let primary = window.primary_monitor().map_err(|error| error.to_string())?.ok_or("未检测到主屏幕")?;
            let primary_height = primary.size().height as f64 / primary.scale_factor();
            // These two NSPanel writes execute in this single synchronous IPC
            // callback; no independent Tauri position queues or resize calls.
            unsafe {
                let frame: tauri_nspanel::NSRect = tauri_nspanel::objc2::msg_send![panel.as_panel(), frame];
                let point = tauri_nspanel::NSPoint::new(x as f64 / origin.scale, primary_height - y as f64 / origin.scale - frame.size.height);
                let _: () = tauri_nspanel::objc2::msg_send![panel.as_panel(), setFrameOrigin: point];
            }
        }
        #[cfg(not(target_os = "macos"))]
        window.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_chat_window(app: AppHandle) -> Result<(), String> {
    app.state::<ChatHitState>().visible.store(true, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    update_chat_pointer_policy(&app)?;
    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel("chat")
            .map_err(|error| format!("无法获取聊天面板：{error:?}"))?;
        panel.show_and_make_key();
        // Making the chat key orders it above its parent. Restore the cat's
        // visual order without taking keyboard focus away from the composer.
        let pet = app.get_webview_panel("main")
            .map_err(|error| format!("无法获取桌宠面板：{error:?}"))?;
        pet.order_front_regardless();
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app
            .get_webview_window("chat")
            .ok_or_else(|| "找不到聊天窗口".to_owned())?;
        window
            .show()
            .map_err(|error| format!("显示聊天窗口失败：{error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("聚焦聊天窗口失败：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
fn set_chat_window_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    set_pet_chat_mode(app, if expanded { "expanded" } else { "compact" }.to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(backend::AgentState::default());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .manage(ChatHitState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            motion_diagnostics::install(app.handle());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            for label in ["main", "chat"] {
                if let Some(window) = app.get_webview_window(label) {
                    make_visible_on_every_space(window, true)?;
                }
            }
            if let Some(pet) = app.get_webview_window("main") {
                pet.set_size(LogicalSize::new(PET_CLOSED_WIDTH, PET_CLOSED_HEIGHT))?;
            }
            position_pet_at_bottom_right(app.handle())?;
            set_pet_chat_mode(app.handle().clone(), "compact".to_owned())?;
            #[cfg(target_os = "macos")]
            if let Ok(panel) = app.get_webview_panel("main") {
                // The window is converted to NSPanel during setup, so its
                // original `visible: true` state is not reliable on relaunch.
                panel.show();
                panel.order_front_regardless();
            }
            // Explicitly hide the empty chat surface so it cannot intercept desktop input.
            if let Some(chat) = app.get_webview_window("chat") { chat.hide()?; }
            #[cfg(target_os = "macos")]
            {
                update_chat_pointer_policy(app.handle())?;
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_millis(16));
                    let state = handle.state::<ChatHitState>();
                    if !state.visible.load(Ordering::Relaxed) || state.poll_pending.swap(true, Ordering::Relaxed) { continue; }
                    let current = handle.clone();
                    if handle.run_on_main_thread(move || {
                        let _ = update_chat_pointer_policy(&current);
                        current.state::<ChatHitState>().poll_pending.store(false, Ordering::Relaxed);
                    }).is_err() { break; }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::agent_view,
            backend::save_agent_settings,
            backend::agent_submit,
            backend::agent_list_models,
            backend::agent_list_todos,
            backend::agent_complete_todo,
            backend::agent_reopen_todo,
            backend::agent_set_todo_reminder,
            backend::agent_create_todo,
            backend::agent_update_todo,
            backend::agent_delete_todo,
            save_pet_position,
            reset_pet_position,
            quit_app,
            set_pet_chat_mode,
            set_chat_window_expanded,
            show_chat_window,
            pet_drag_origin,
            move_pet_group,
            set_chat_hit_bounds,
            end_pet_group_drag
        ])
        .run(tauri::generate_context!())
        .expect("error while running desktop AI pet");
}
