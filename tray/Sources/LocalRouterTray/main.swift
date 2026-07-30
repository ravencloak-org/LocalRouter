// LocalRouter macOS menu-bar app (ADR-0003). Thin native launcher: it drives the core's
// /control/* endpoints and shells `claude login` / `open`. No business logic here.
import AppKit
import Foundation

let PORT = ProcessInfo.processInfo.environment["LR_PORT"].flatMap { Int($0) } ?? 8083
let BASE = "http://127.0.0.1:\(PORT)"
let DASHBOARD = ProcessInfo.processInfo.environment["LR_DASHBOARD"] ?? "http://127.0.0.1:5173"
let MODELS = ["sonnet", "opus", "haiku"]
let EFFORTS = ["low", "medium", "high"]

struct Status: Decodable {
    var running: Bool
    var loggedIn: Bool
    var model: String
    var effort: String?
    var queueDepth: Int
}

enum Control {
    static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil,
                        done: @escaping (Data?) -> Void) {
        guard let url = URL(string: BASE + path) else { return done(nil) }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 3
        r.setValue("1", forHTTPHeaderField: "X-LocalRouter") // CSRF guard header
        if let body {
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        URLSession.shared.dataTask(with: r) { data, _, _ in done(data) }.resume()
    }

    static func status(_ cb: @escaping (Status?) -> Void) {
        request("/control/status") { cb($0.flatMap { try? JSONDecoder().decode(Status.self, from: $0) }) }
    }
    static func setConfig(model: String? = nil, effort: String? = nil) {
        var b: [String: Any] = [:]
        if let model { b["model"] = model }
        if let effort { b["effort"] = effort }
        request("/control/config", method: "POST", body: b) { _ in }
    }
    static func shutdown() { request("/control/shutdown", method: "POST") { _ in } }

    static func login() {
        // Interactive OAuth needs a TTY -> run in Terminal.app (ADR-0003).
        osascript("""
        tell application "Terminal"
            activate
            do script "claude login"
        end tell
        """)
    }
}

func osascript(_ src: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", src]
    try? p.run()
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var last: Status?
    var timer: Timer?
    var coreProc: Process? // core spawned by the tray (Start), so Stop can restart it

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar only, no Dock icon
        if let icon = loadTrayIcon() {
            item.button?.image = icon
            item.button?.imagePosition = .imageLeading
        } else {
            item.button?.title = "LR" // fallback if resource missing
        }
        rebuild()
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func refresh() {
        Control.status { s in DispatchQueue.main.async { self.last = s; self.rebuild() } }
    }
    func refreshSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.refresh() }
    }

    func loadTrayIcon() -> NSImage? {
        guard let url = Bundle.module.url(forResource: "tray", withExtension: "png"),
              let img = NSImage(contentsOf: url) else { return nil }
        img.size = NSSize(width: 18, height: 18) // menu-bar height
        img.isTemplate = false // colored logo, not a monochrome mask
        return img
    }

    func rebuild() {
        let s = last
        // logo image is set once; the title carries the at-a-glance state glyph
        item.button?.title = s == nil ? " ○" : (s!.loggedIn ? " ●" : " ⚠")

        let m = NSMenu()
        let headTitle: String
        if let s {
            headTitle = "● running · \(s.model)\(s.effort.map { " · " + $0 } ?? "")"
                + (s.loggedIn ? "" : " · NOT logged in")
        } else {
            headTitle = "○ core not reachable"
        }
        let head = NSMenuItem(title: headTitle, action: nil, keyEquivalent: "")
        head.isEnabled = false
        m.addItem(head)
        m.addItem(.separator())

        m.addItem(mk("Login (claude)…", #selector(doLogin)))

        let modelItem = NSMenuItem(title: "Model", action: nil, keyEquivalent: "")
        let modelMenu = NSMenu()
        for name in MODELS {
            let it = mk(name, #selector(pickModel(_:)))
            it.representedObject = name
            it.state = (s?.model == name) ? .on : .off
            modelMenu.addItem(it)
        }
        modelItem.submenu = modelMenu
        m.addItem(modelItem)

        let effortItem = NSMenuItem(title: "Effort", action: nil, keyEquivalent: "")
        let effortMenu = NSMenu()
        for name in EFFORTS {
            let it = mk(name, #selector(pickEffort(_:)))
            it.representedObject = name
            it.state = (s?.effort == name) ? .on : .off
            effortMenu.addItem(it)
        }
        effortItem.submenu = effortMenu
        m.addItem(effortItem)

        m.addItem(.separator())
        let running = s != nil
        let start = mk("Start Core", #selector(startCore)); start.isEnabled = !running
        m.addItem(start)
        let stop = mk("Stop Core", #selector(stopCore)); stop.isEnabled = running
        m.addItem(stop)
        m.addItem(mk("Open Dashboard", #selector(openDashboard)))
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "Quit Tray", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = m
    }

    func mk(_ title: String, _ sel: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: sel, keyEquivalent: "")
        it.target = self
        return it
    }

    @objc func doLogin() { Control.login() }
    @objc func pickModel(_ i: NSMenuItem) { Control.setConfig(model: i.representedObject as? String); refreshSoon() }
    @objc func pickEffort(_ i: NSMenuItem) { Control.setConfig(effort: i.representedObject as? String); refreshSoon() }
    @objc func openDashboard() { if let u = URL(string: DASHBOARD) { NSWorkspace.shared.open(u) } }

    @objc func startCore() {
        if last != nil { return } // already running per last poll
        coreProc = spawnCore()
        refreshSoon()
    }
    @objc func stopCore() {
        Control.shutdown() // graceful; core exits, next poll shows stopped
        coreProc = nil
        refreshSoon()
    }

    // Launch the core. Resolution order: $LR_CORE ("cmd arg arg") -> bundled localrouter-core
    // (with the bundled dashboard as cwd) -> dev fallback `bun $LR_REPO/core/server.ts`.
    func spawnCore() -> Process? {
        let env = ProcessInfo.processInfo.environment
        let p = Process()
        if let c = env["LR_CORE"], !c.isEmpty {
            let parts = c.split(separator: " ").map(String.init)
            p.executableURL = URL(fileURLWithPath: parts[0])
            p.arguments = Array(parts.dropFirst())
        } else if let exeDir = Bundle.main.executableURL?.deletingLastPathComponent(),
                  FileManager.default.isExecutableFile(atPath: exeDir.appendingPathComponent("localrouter-core").path) {
            p.executableURL = exeDir.appendingPathComponent("localrouter-core")
            // bundled dashboard lives in ../Resources/web/dist (build-app.sh); serve it via cwd
            p.currentDirectoryURL = exeDir.deletingLastPathComponent().appendingPathComponent("Resources")
        } else {
            let repo = env["LR_REPO"] ?? FileManager.default.currentDirectoryPath
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = ["bun", "\(repo)/core/server.ts"]
            p.currentDirectoryURL = URL(fileURLWithPath: repo)
        }
        do { try p.run(); return p } catch { return nil }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
