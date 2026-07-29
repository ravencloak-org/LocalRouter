import { mount } from "ripple";
import { App } from "./App.ripple";

// ponytail: verify `mount` signature against ripple-ts.com (alpha). May be
// mount(App, { target }) or App({ target }) depending on pinned version.
mount(App, { target: document.getElementById("root")! });
