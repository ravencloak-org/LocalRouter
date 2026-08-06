// Periodic self-update for the Windows/Linux tray (mirrors the macOS Updater.swift).
// Polls GitHub's latest release, compares against the build-time `version`, then either
// auto-updates the whole bundle (tray + core + dashboard) or surfaces it in the menu.
//
// The atomic running-binary replacement (incl. the Windows locked-exe rename dance) is
// delegated to github.com/minio/selfupdate — not hand-rolled.
//
// ponytail: version compare is numeric-dotted, good enough for vMAJOR.MINOR.PATCH tags.
package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"fyne.io/systray"
	"github.com/minio/selfupdate"
)

const (
	repo          = "ravencloak-org/LocalRouter"
	checkInterval = 6 * time.Hour
)

// version is stamped at build time via -ldflags "-X main.version=<tag>". "dev" locally.
var version = "dev"

type release struct {
	version string
	zipURL  string
	notes   string
	htmlURL string
}

type trayConfig struct {
	AutoUpdate bool `json:"autoUpdate"`
}

func configPath() string {
	dir := os.Getenv("LR_CONFIG_DIR")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config", "localrouter")
	}
	return filepath.Join(dir, "tray.json")
}

func loadConfig() trayConfig {
	var c trayConfig
	if b, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func saveConfig(c trayConfig) {
	p := configPath()
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if b, err := json.Marshal(c); err == nil {
		_ = os.WriteFile(p, b, 0o644)
	}
}

// bundleAsset is the release zip name for this OS/arch (matches the build-tray CI job).
func bundleAsset() string {
	arch := runtime.GOARCH // amd64 | arm64
	return fmt.Sprintf("LocalRouter-%s-%s.zip", runtime.GOOS, arch)
}

// "1.2.10" > "1.2.9"; pads missing components; ignores any pre-release suffix after '-'.
func isNewer(a, b string) bool {
	parts := func(s string) []int {
		s = strings.TrimPrefix(s, "v")
		if i := strings.IndexByte(s, '-'); i >= 0 {
			s = s[:i]
		}
		var out []int
		for _, p := range strings.Split(s, ".") {
			n, _ := strconv.Atoi(p)
			out = append(out, n)
		}
		return out
	}
	x, y := parts(a), parts(b)
	for i := 0; i < max(len(x), len(y)); i++ {
		xi, yi := 0, 0
		if i < len(x) {
			xi = x[i]
		}
		if i < len(y) {
			yi = y[i]
		}
		if xi != yi {
			return xi > yi
		}
	}
	return false
}

// checkForUpdate queries the latest release; returns non-nil only when newer + this OS/arch has a bundle.
func checkForUpdate() *release {
	url := "https://api.github.com/repos/" + repo + "/releases/latest"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var j struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if json.NewDecoder(resp.Body).Decode(&j) != nil {
		return nil
	}
	latest := strings.TrimPrefix(j.TagName, "v")
	if !isNewer(latest, version) {
		return nil
	}
	want := bundleAsset()
	for _, a := range j.Assets {
		if a.Name == want {
			return &release{version: latest, zipURL: a.URL, notes: j.Body, htmlURL: j.HTMLURL}
		}
	}
	return nil // no bundle for this platform (e.g. tray not yet packaged for this arch)
}

// install downloads the bundle zip, stops the core (unlock on Windows), swaps core + dashboard +
// the running tray binary (via selfupdate), then relaunches the tray.
func install(rel *release) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	dir := filepath.Dir(exe)

	// download zip
	resp, err := http.Get(rel.zipURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	work, err := os.MkdirTemp("", "lr-update-")
	if err != nil {
		return err
	}
	zipPath := filepath.Join(work, "bundle.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		return err
	}
	f.Close()

	extract := filepath.Join(work, "x")
	if err := unzip(zipPath, extract); err != nil {
		return err
	}

	coreName := "localrouter-core"
	trayName := "localrouter-tray"
	if runtime.GOOS == "windows" {
		coreName += ".exe"
		trayName += ".exe"
	}
	newCore := filepath.Join(extract, coreName)
	newTray := filepath.Join(extract, trayName)
	newWeb := filepath.Join(extract, "web", "dist")
	if _, err := os.Stat(newTray); err != nil {
		return fmt.Errorf("tray binary missing from bundle: %w", err)
	}

	// stop the core so its binary isn't locked (Windows), then swap it
	shutdown()
	time.Sleep(1 * time.Second)
	if _, err := os.Stat(newCore); err == nil {
		if err := applyFile(newCore, filepath.Join(dir, coreName)); err != nil {
			return fmt.Errorf("core swap: %w", err)
		}
	}
	// refresh bundled dashboard
	if _, err := os.Stat(newWeb); err == nil {
		dst := filepath.Join(dir, "web", "dist")
		_ = os.RemoveAll(dst)
		_ = copyTree(newWeb, dst)
	}
	// replace the RUNNING tray binary (selfupdate handles the Windows rename)
	tf, err := os.Open(newTray)
	if err != nil {
		return err
	}
	defer tf.Close()
	if err := selfupdate.Apply(tf, selfupdate.Options{TargetPath: exe}); err != nil {
		return err
	}
	// relaunch the (now-updated) tray and exit
	_ = exec.Command(exe).Start()
	return nil
}

// applyFile atomically replaces dst with the binary at src using selfupdate (handles locked files).
func applyFile(src, dst string) error {
	r, err := os.Open(src)
	if err != nil {
		return err
	}
	defer r.Close()
	return selfupdate.Apply(r, selfupdate.Options{TargetPath: dst})
}

func unzip(src, dst string) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, zf := range zr.File {
		p := filepath.Join(dst, zf.Name) //nolint:gosec // trusted release artifact
		if zf.FileInfo().IsDir() {
			_ = os.MkdirAll(p, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		rc, err := zf.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(p, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, zf.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc) //nolint:gosec
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode())
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}

// updateLoop checks on launch then every checkInterval.
func updateLoop() {
	runCheck(false)
	t := time.NewTicker(checkInterval)
	defer t.Stop()
	for range t.C {
		runCheck(false)
	}
}

// runCheck fetches the latest release and either auto-installs, reveals the menu item,
// or (manual only) reports "up to date" via the error line.
func runCheck(manual bool) {
	rel := checkForUpdate()
	if rel == nil {
		availableRel = nil
		if mUpdate != nil {
			mUpdate.Hide()
		}
		if manual && mErr != nil {
			mErr.SetTitle("✓ up to date (" + version + ")")
			mErr.Show()
		}
		return
	}
	availableRel = rel
	if cfg.AutoUpdate {
		doInstall()
		return
	}
	if mUpdate != nil {
		mUpdate.SetTitle("⤓ Install update: " + rel.version)
		mUpdate.Show()
	}
}

// doInstall runs the swap; on success the process re-execs the new tray and exits.
func doInstall() {
	if availableRel == nil {
		return
	}
	if err := install(availableRel); err != nil {
		if mErr != nil {
			mErr.SetTitle("⚠ update failed: " + err.Error())
			mErr.Show()
		}
		return
	}
	systray.Quit()
	os.Exit(0)
}
