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
	base      = envOr("LR_BASE", "http://127.0.0.1:8083")
	dashboard = envOr("LR_DASHBOARD", "http://127.0.0.1:5173")
	models    = []string{"sonnet", "opus", "haiku"}
	efforts   = []string{"low", "medium", "high"}

	mStatus     *systray.MenuItem
	modelItems  []*systray.MenuItem
	effortItems []*systray.MenuItem
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type status struct {
	Running  bool    `json:"running"`
	LoggedIn bool    `json:"loggedIn"`
	Model    string  `json:"model"`
	Effort   *string `json:"effort"`
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
		exec.Command("cmd", "/c", "start", "claude", "login").Start()
	case "darwin":
		exec.Command("osascript", "-e", `tell application "Terminal" to do script "claude login"`).Start()
	default: // linux/bsd
		exec.Command("x-terminal-emulator", "-e", "claude", "login").Start()
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
	if s == nil {
		mStatus.SetTitle("○ core not reachable")
		systray.SetTitle("LR ○")
		return
	}
	eff := "—"
	if s.Effort != nil {
		eff = *s.Effort
	}
	login := "logged in"
	glyph := "●"
	if !s.LoggedIn {
		login, glyph = "LOGGED OUT", "⚠"
	}
	mStatus.SetTitle(fmt.Sprintf("● %s · effort:%s · %s", s.Model, eff, login))
	systray.SetTitle("LR " + glyph)
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
	systray.SetTitle("LR")
	systray.SetTooltip("LocalRouter")

	mStatus = systray.AddMenuItem("…", "")
	mStatus.Disable()
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
	mDash := systray.AddMenuItem("Open Dashboard", "")
	mStop := systray.AddMenuItem("Stop Core", "")
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
			case <-mStop.ClickedCh:
				shutdown()
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
