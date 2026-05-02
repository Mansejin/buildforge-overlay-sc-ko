// src-tauri/src/window.rs
// Owns the main BrowserWindow lifecycle: applies the always-on-top topmost
// flag, exposes per-platform opacity setting (Win32 layered window / NSWindow
// alphaValue / GtkWidget opacity), wires the F12 / Ctrl+Shift+I devtools
// toggle, and registers all Ctrl+Alt-* global shortcuts that the overlay
// relies on. Mirrors src/main/window.ts.

use crate::types::{HotkeyAction, ViewMode, WindowSize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewWindow};

/// Shared "should this window stay always-on-top?" flag. The focus-loss
/// keeper consults this; `set_mode` flips it when the user toggles between
/// Manager (false) and Overlay (true). Without this, focus changes in
/// Manager mode kept yanking the window back on top of every other app.
static OVERLAY_AOT_DESIRED: AtomicBool = AtomicBool::new(true);
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

// objc 0.2's msg_send! / sel! macros aren't fully path-qualified internally;
// they look up sel! and sel_impl! in the call site's scope. Importing them
// here means the #[cfg(target_os = "macos")] block below can call msg_send!
// without "cannot find macro `sel` in this scope" on the macOS runner.
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

// gtk's set_opacity comes through WidgetExt; gtk-rs splits methods across
// extension traits, so the trait must be in scope at the call site.
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

pub const MAIN_WINDOW_LABEL: &str = "main";

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

/// Apply per-platform window opacity. Tauri 2 doesn't ship a cross-platform
/// `set_opacity`, so we go to the OS handle.
#[allow(unused_variables)]
pub fn set_opacity(window: &WebviewWindow, value: f64) {
    let clamped = value.clamp(0.4, 1.0);

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_LAYERED,
        };
        if let Ok(hwnd) = window.hwnd() {
            let alpha_byte = (clamped * 255.0) as u8;
            unsafe {
                let raw = hwnd.0 as isize;
                let hwnd_native: windows_sys::Win32::Foundation::HWND = raw as _;
                let ex = GetWindowLongPtrW(hwnd_native, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd_native, GWL_EXSTYLE, ex | WS_EX_LAYERED as isize);
                let _ = SetLayeredWindowAttributes(hwnd_native, 0, alpha_byte, LWA_ALPHA);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_window_ptr) = window.ns_window() {
            unsafe {
                let ns_window = ns_window_ptr as *mut objc::runtime::Object;
                let _: () = msg_send![ns_window, setAlphaValue: clamped];
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(gtk_window) = window.gtk_window() {
            gtk_window.set_opacity(clamped);
        }
    }
}

/// Apply the per-mode window chrome. Manager mode gets normal decorations,
/// resizable, and the user's saved manager size. Overlay mode is frameless,
/// always-on-top, fixed-size, and uses the saved overlay size. Both keep the
/// existing visibility / opacity state.
pub fn set_mode(window: &WebviewWindow, mode: ViewMode, sizes: ManagerSizes) {
    let size = match mode {
        ViewMode::Manager => sizes.manager,
        ViewMode::Overlay => sizes.overlay,
    };
    let _ = window.set_size(LogicalSize::new(size.width as f64, size.height as f64));
    match mode {
        ViewMode::Manager => {
            OVERLAY_AOT_DESIRED.store(false, Ordering::Relaxed);
            let _ = window.set_decorations(true);
            let _ = window.set_resizable(true);
            let _ = window.set_always_on_top(false);
            let _ = window.set_skip_taskbar(false);
            // Manager is the "main program" surface; let the user pull it
            // up like any other window.
            let _ = window.center();
        }
        ViewMode::Overlay => {
            OVERLAY_AOT_DESIRED.store(true, Ordering::Relaxed);
            let _ = window.set_decorations(false);
            let _ = window.set_resizable(false);
            let _ = window.set_always_on_top(true);
            // Keep the overlay in the taskbar so users can find it; setting
            // skip_taskbar(true) here causes Windows to lose the window
            // entirely if minimised.
            let _ = window.set_skip_taskbar(false);
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ManagerSizes {
    pub manager: WindowSize,
    pub overlay: WindowSize,
}

pub fn toggle_visible(window: &WebviewWindow) {
    let is_visible = window.is_visible().unwrap_or(true);
    if is_visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn toggle_devtools(window: &WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// Re-apply always-on-top after the window loses focus when the user has
/// us in Overlay mode. Works around a Tauri 2 / wry quirk on Windows where
/// clicking the taskbar can drop the overlay below it. Manager mode opts
/// out via OVERLAY_AOT_DESIRED so it behaves like a normal app window.
pub fn install_always_on_top_keeper(window: &WebviewWindow) {
    let cloned = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            if !focused && OVERLAY_AOT_DESIRED.load(Ordering::Relaxed) {
                let _ = cloned.set_always_on_top(true);
            }
        }
    });
}

fn shortcut_to_action(shortcut: &Shortcut) -> Option<HotkeyAction> {
    let ctrl_alt = Modifiers::CONTROL | Modifiers::ALT;
    let ctrl_alt_shift = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    if shortcut.matches(ctrl_alt, Code::Digit1) {
        return Some(HotkeyAction::RaceTerran);
    }
    if shortcut.matches(ctrl_alt, Code::Digit2) {
        return Some(HotkeyAction::RaceProtoss);
    }
    if shortcut.matches(ctrl_alt, Code::Digit3) {
        return Some(HotkeyAction::RaceZerg);
    }
    if shortcut.matches(ctrl_alt, Code::KeyQ) {
        return Some(HotkeyAction::OppTerran);
    }
    if shortcut.matches(ctrl_alt, Code::KeyW) {
        return Some(HotkeyAction::OppZerg);
    }
    if shortcut.matches(ctrl_alt, Code::KeyE) {
        return Some(HotkeyAction::OppProtoss);
    }
    if shortcut.matches(ctrl_alt, Code::KeyR) {
        return Some(HotkeyAction::OppRandom);
    }
    if shortcut.matches(ctrl_alt_shift, Code::KeyB) {
        return Some(HotkeyAction::PrevBuild);
    }
    if shortcut.matches(ctrl_alt, Code::KeyB) {
        return Some(HotkeyAction::NextBuild);
    }
    if shortcut.matches(ctrl_alt, Code::PageDown) {
        return Some(HotkeyAction::NextPage);
    }
    if shortcut.matches(ctrl_alt, Code::PageUp) {
        return Some(HotkeyAction::PrevPage);
    }
    if shortcut.matches(ctrl_alt, Code::Digit0) {
        return Some(HotkeyAction::FirstPage);
    }
    if shortcut.matches(ctrl_alt, Code::KeyF) {
        return Some(HotkeyAction::ToggleFavorite);
    }
    if shortcut.matches(ctrl_alt, Code::KeyC) {
        return Some(HotkeyAction::ToggleCompact);
    }
    if shortcut.matches(ctrl_alt, Code::KeyH) {
        return Some(HotkeyAction::ToggleWindow);
    }
    if shortcut.matches(ctrl_alt, Code::KeyM) {
        return Some(HotkeyAction::ToggleMode);
    }
    None
}

fn all_shortcuts() -> Vec<Shortcut> {
    let ctrl_alt = Modifiers::CONTROL | Modifiers::ALT;
    let ctrl_alt_shift = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    vec![
        Shortcut::new(Some(ctrl_alt), Code::Digit1),
        Shortcut::new(Some(ctrl_alt), Code::Digit2),
        Shortcut::new(Some(ctrl_alt), Code::Digit3),
        Shortcut::new(Some(ctrl_alt), Code::KeyQ),
        Shortcut::new(Some(ctrl_alt), Code::KeyW),
        Shortcut::new(Some(ctrl_alt), Code::KeyE),
        Shortcut::new(Some(ctrl_alt), Code::KeyR),
        Shortcut::new(Some(ctrl_alt), Code::KeyB),
        Shortcut::new(Some(ctrl_alt_shift), Code::KeyB),
        Shortcut::new(Some(ctrl_alt), Code::PageDown),
        Shortcut::new(Some(ctrl_alt), Code::PageUp),
        Shortcut::new(Some(ctrl_alt), Code::Digit0),
        Shortcut::new(Some(ctrl_alt), Code::KeyF),
        Shortcut::new(Some(ctrl_alt), Code::KeyC),
        Shortcut::new(Some(ctrl_alt), Code::KeyH),
        Shortcut::new(Some(ctrl_alt), Code::KeyM),
    ]
}

pub fn register_shortcuts(app: &AppHandle) -> Result<(), tauri_plugin_global_shortcut::Error> {
    let app_handle = app.clone();
    let shortcuts = all_shortcuts();
    let manager = app.global_shortcut();
    manager.on_shortcuts(shortcuts, move |_app, shortcut, event: ShortcutEvent| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        if let Some(action) = shortcut_to_action(shortcut) {
            let _ = app_handle.emit("hotkey", action);
        }
    })?;
    Ok(())
}

pub fn unregister_shortcuts(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}
