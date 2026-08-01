// LocalRouter tray for Windows/Linux (ADR-0003). Cross-platform native tray via
// fyne.io/systray; mirrors the macOS Swift tray. Thin launcher over the core /control/* API.
package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"fyne.io/systray"
)

//go:embed icon.png
var iconPNG []byte

//go:embed icon.ico
var iconICO []byte

// trayIcon returns the format systray wants per OS: ICO on Windows, PNG elsewhere.
func trayIcon() []byte {
	if runtime.GOOS == "windows" {
		return iconICO
	}
	return iconPNG
}

var (
	base = envOr("LR_BASE", "http://127.0.0.1:8083")
	// the core SERVES the dashboard, so open the core URL — not the Vite dev port (5173)
	dashboard = envOr("LR_DASHBOARD", base)
	models    = []string{"sonnet", "opus", "haiku"}
	efforts   = []string{"low", "medium", "high"}

	mStatus     *systray.MenuItem
	mURL        *systray.MenuItem
	mErr        *systray.MenuItem
	mStart      *systray.MenuItem
	mStop       *systray.MenuItem
	modelItems  []*systray.MenuItem
	effortItems []*systray.MenuItem
	coreProc    *exec.Cmd // core spawned by the tray (Start), so Stop can restart it
)

// spawnCore launches the core: $LR_CORE ("cmd arg..") -> bundled localrouter-core (cwd = its
// dir, which holds ./web/dist) -> dev fallback `bun $LR_REPO/core/server.ts`.
func spawnCore() *exec.Cmd {
	var cmd *exec.Cmd
	// prefer the bundled self-contained binary (absolute path, no PATH needed)
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		core := filepath.Join(dir, "localrouter-core")
		if runtime.GOOS == "windows" {
			core += ".exe"
		}
		if _, e := os.Stat(core); e == nil {
			cmd = exec.Command(core)
			cmd.Dir = dir
		}
	}
	if cmd == nil {
		// dev fallback via a LOGIN shell so PATH (bun) resolves under a GUI launch
		line := os.Getenv("LR_CORE")
		repo := envOr("LR_REPO", ".")
		if line == "" {
			line = "bun " + filepath.Join(repo, "core", "server.ts")
		}
		if runtime.GOOS == "windows" {
			cmd = exec.Command("cmd", "/c", line)
		} else {
			cmd = exec.Command("/bin/sh", "-lc", line)
		}
		cmd.Dir = repo
	}
	if cmd.Start() != nil {
		return nil
	}
	return cmd
}

func startCore() {
	if getStatus() != nil {
		return // already running
	}
	coreProc = spawnCore()
	if coreProc == nil && mErr != nil {
		mErr.SetTitle("⚠ start failed — no bundled core / LR_REPO")
		mErr.Show()
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type status struct {
	Running          bool    `json:"running"`
	LoggedIn         bool    `json:"loggedIn"`
	Model            string  `json:"model"`
	Effort           *string `json:"effort"`
	Port             int     `json:"port"`
	AnthropicBaseURL *string `json:"anthropicBaseUrl"`
}

// req sends a /control/* request with the required CSRF header.
func req(method, path string, body map[string]string) []byte {
	var r *http.Request
	if body != nil {
		b, _ := json.Marshal(body)
		r, _ = http.NewRequest(method, base+path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r, _ = http.NewRequest(method, base+path, nil)
	}
	r.Header.Set("X-LocalRouter", "1")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(r)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return data
}

func getStatus() *status {
	data := req("GET", "/control/status", nil)
	if data == nil {
		return nil
	}
	var s status
	if json.Unmarshal(data, &s) != nil {
		return nil
	}
	return &s
}

func setConfig(patch map[string]string) { req("POST", "/control/config", patch) }
func shutdown()                         { req("POST", "/control/shutdown", nil) }

// login runs interactive `claude login` (needs a TTY) in a per-OS terminal.
func login() {
	switch runtime.GOOS {
	case "windows":
		exec.Command("cmd", "/c", "start", "cmd", "/k", "claude setup-token").Start()
	case "darwin":
		exec.Command("osascript",
			"-e", `tell application "Terminal" to do script "claude setup-token"`,
			"-e", `tell application "Terminal" to activate`).Start()
	default: // linux/bsd
		exec.Command("x-terminal-emulator", "-e", "sh", "-lc", "claude setup-token").Start()
	}
}

func openURL(u string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		exec.Command("open", u).Start()
	default:
		exec.Command("xdg-open", u).Start()
	}
}

func updateUI(s *status) {
	running := s != nil
	// show only the relevant lifecycle action
	if mStart != nil {
		if running {
			mStart.Hide()
		} else {
			mStart.Show()
		}
	}
	if mStop != nil {
		if running {
			mStop.Show()
		} else {
			mStop.Hide()
		}
	}
	if running && mErr != nil {
		mErr.Hide() // clear stale error once the core is up
	}
	if s == nil {
		mStatus.SetTitle("○ core not reachable")
		if mURL != nil {
			mURL.SetTitle("Anthropic: —")
		}
		return
	}
	eff := "—"
	if s.Effort != nil {
		eff = *s.Effort
	}
	login := "logged in"
	if !s.LoggedIn {
		login = "LOGGED OUT"
	}
	mStatus.SetTitle(fmt.Sprintf("● :%d · %s · effort:%s · %s", s.Port, s.Model, eff, login))
	url := "default (api.anthropic.com)"
	if s.AnthropicBaseURL != nil && *s.AnthropicBaseURL != "" {
		url = *s.AnthropicBaseURL
	}
	if mURL != nil {
		mURL.SetTitle("Anthropic: " + url)
	}
	// main icon = logo only; state lives in the menu (no glyph on the title)
	for i, it := range modelItems {
		if models[i] == s.Model {
			it.Check()
		} else {
			it.Uncheck()
		}
	}
	for i, it := range effortItems {
		if s.Effort != nil && efforts[i] == *s.Effort {
			it.Check()
		} else {
			it.Uncheck()
		}
	}
}

func onReady() {
	systray.SetIcon(trayIcon()) // ICO on Windows, PNG on linux/mac
	systray.SetTooltip("LocalRouter")

	mStatus = systray.AddMenuItem("…", "")
	mStatus.Disable()
	mURL = systray.AddMenuItem("Anthropic: …", "")
	mURL.Disable()
	mErr = systray.AddMenuItem("", "")
	mErr.Disable()
	mErr.Hide()
	systray.AddSeparator()

	mLogin := systray.AddMenuItem("Login (claude)…", "opens a terminal running claude login")
	mModel := systray.AddMenuItem("Model", "")
	for _, name := range models {
		it := mModel.AddSubMenuItemCheckbox(name, "", false)
		modelItems = append(modelItems, it)
		go func(n string, item *systray.MenuItem) {
			for range item.ClickedCh {
				setConfig(map[string]string{"model": n})
			}
		}(name, it)
	}
	mEffort := systray.AddMenuItem("Effort", "")
	for _, name := range efforts {
		it := mEffort.AddSubMenuItemCheckbox(name, "", false)
		effortItems = append(effortItems, it)
		go func(n string, item *systray.MenuItem) {
			for range item.ClickedCh {
				setConfig(map[string]string{"effort": n})
			}
		}(name, it)
	}
	systray.AddSeparator()
	mStart = systray.AddMenuItem("Start Core", "")
	mStop = systray.AddMenuItem("Stop Core", "")
	mDash := systray.AddMenuItem("Open Dashboard", "")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit Tray", "")

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		updateUI(getStatus())
		for {
			select {
			case <-ticker.C:
				updateUI(getStatus())
			case <-mLogin.ClickedCh:
				login()
			case <-mDash.ClickedCh:
				openURL(dashboard)
			case <-mStart.ClickedCh:
				startCore()
				time.Sleep(600 * time.Millisecond)
				updateUI(getStatus())
			case <-mStop.ClickedCh:
				shutdown()
				coreProc = nil
				time.Sleep(400 * time.Millisecond)
				updateUI(getStatus())
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func main() { systray.Run(onReady, func() {}) }
