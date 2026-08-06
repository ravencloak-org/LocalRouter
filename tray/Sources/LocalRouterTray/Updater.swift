// Periodic self-update for the LocalRouter menu-bar app.
// Polls the GitHub "latest release", compares versions, then either auto-installs
// (download zip -> swap the .app bundle in place -> relaunch) or surfaces the update
// in the menu + an alert for the user to confirm. Toggle persisted in UserDefaults.
//
// ponytail: bespoke updater, not Sparkle. Fine for an unsigned v0 (Sparkle's value is
// signed/notarized appcasts + delta patches). Upgrade path when the app gets a Developer
// ID: adopt Sparkle + an appcast feed and drop this file.
import AppKit
import Foundation

struct AvailableRelease {
    let version: String
    let zipURL: URL
    let notes: String
    let htmlURL: URL
}

final class Updater {
    static let repo = "ravencloak-org/LocalRouter"
    static let checkInterval: TimeInterval = 6 * 3600 // 6h
    static let macAsset = "LocalRouter-macos.zip"

    private(set) var available: AvailableRelease?
    var onChange: (() -> Void)? // menu rebuild hook
    private var timer: Timer?
    private var installing = false

    var autoUpdate: Bool {
        get { UserDefaults.standard.bool(forKey: "autoUpdate") }
        set { UserDefaults.standard.set(newValue, forKey: "autoUpdate") }
    }

    static var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    }

    func start() {
        check() // on launch
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkInterval, repeats: true) { [weak self] _ in self?.check() }
    }

    // MARK: - Check

    func check(manual: Bool = false) {
        guard let url = URL(string: "https://api.github.com/repos/\(Self.repo)/releases/latest") else { return }
        var r = URLRequest(url: url)
        r.timeoutInterval = 10
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: r) { [weak self] data, _, _ in
            guard let self else { return }
            guard let data,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = j["tag_name"] as? String else {
                if manual { DispatchQueue.main.async { self.alert("Update check failed", "Could not reach GitHub.") } }
                return
            }
            let latest = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
            let notes = j["body"] as? String ?? ""
            let htmlURL = URL(string: (j["html_url"] as? String) ?? "") ?? URL(string: "https://github.com/\(Self.repo)/releases")!
            let assets = j["assets"] as? [[String: Any]] ?? []
            let zip = assets.first { ($0["name"] as? String) == Self.macAsset }
                .flatMap { $0["browser_download_url"] as? String }
                .flatMap { URL(string: $0) }

            DispatchQueue.main.async {
                let wasKnown = self.available?.version == latest
                if Self.isNewer(latest, than: Self.currentVersion), let zip {
                    self.available = AvailableRelease(version: latest, zipURL: zip, notes: notes, htmlURL: htmlURL)
                    self.onChange?()
                    if self.autoUpdate {
                        self.install()
                    } else if manual || !wasKnown { // prompt on first discovery or explicit check, not every 6h
                        self.presentUpdatePrompt()
                    }
                } else {
                    self.available = nil
                    self.onChange?()
                    if manual { self.alert("You're up to date", "LocalRouter \(Self.currentVersion) is the latest version.") }
                }
            }
        }.resume()
    }

    // "1.2.10" > "1.2.9"; pads missing components with 0; ignores pre-release suffixes after '-'.
    static func isNewer(_ a: String, than b: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            let core = s.split(separator: "-").first.map(String.init) ?? s
            return core.split(separator: ".").map { Int($0) ?? 0 }
        }
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let xi = i < x.count ? x[i] : 0
            let yi = i < y.count ? y[i] : 0
            if xi != yi { return xi > yi }
        }
        return false
    }

    // MARK: - Prompt (non-auto)

    private func presentUpdatePrompt() {
        guard let rel = available else { return }
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Update available: LocalRouter \(rel.version)"
        a.informativeText = rel.notes.isEmpty ? "You're on \(Self.currentVersion)." : String(rel.notes.prefix(600))
        a.addButton(withTitle: "Install & Relaunch")
        a.addButton(withTitle: "Release Notes")
        a.addButton(withTitle: "Later")
        switch a.runModal() {
        case .alertFirstButtonReturn: install()
        case .alertSecondButtonReturn: NSWorkspace.shared.open(rel.htmlURL)
        default: break
        }
    }

    private func alert(_ title: String, _ body: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = body
        a.addButton(withTitle: "OK")
        a.runModal()
    }

    // MARK: - Install (download zip -> swap bundle -> relaunch)

    func install() {
        guard let rel = available, !installing else { return }
        installing = true
        URLSession.shared.downloadTask(with: rel.zipURL) { [weak self] tmp, _, _ in
            guard let self else { return }
            defer { self.installing = false }
            let fm = FileManager.default
            guard let tmp else { return }
            let work = fm.temporaryDirectory.appendingPathComponent("lr-update-\(UUID().uuidString)")
            let zip = work.appendingPathComponent("update.zip")
            do {
                try fm.createDirectory(at: work, withIntermediateDirectories: true)
                try fm.moveItem(at: tmp, to: zip)
            } catch { return }

            // extract with ditto (handles the macOS zip + preserves the .app)
            guard Self.run("/usr/bin/ditto", ["-x", "-k", zip.path, work.path]) == 0 else {
                DispatchQueue.main.async { self.alert("Update failed", "Could not unpack the download.") }
                return
            }
            let newApp = work.appendingPathComponent("LocalRouter.app")
            guard fm.fileExists(atPath: newApp.path) else { return }
            // unsigned app: strip quarantine so the relaunched copy doesn't re-prompt Gatekeeper
            _ = Self.run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", newApp.path])

            let cur = Bundle.main.bundlePath
            let pid = ProcessInfo.processInfo.processIdentifier
            // detached helper: wait for this process to exit, swap the bundle, relaunch
            let script = "while /bin/kill -0 \(pid) 2>/dev/null; do sleep 0.3; done; "
                + "/bin/rm -rf '\(cur)'; /usr/bin/ditto '\(newApp.path)' '\(cur)'; /usr/bin/open '\(cur)'"
            let helper = Process()
            helper.executableURL = URL(fileURLWithPath: "/bin/sh")
            helper.arguments = ["-c", script]
            try? helper.run()

            DispatchQueue.main.async { NSApp.terminate(nil) }
        }.resume()
    }

    @discardableResult
    private static func run(_ path: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        do { try p.run() } catch { return -1 }
        p.waitUntilExit()
        return p.terminationStatus
    }
}
