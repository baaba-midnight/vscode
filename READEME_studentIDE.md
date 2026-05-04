# Student IDE — Setup, Build & Run Guide

This is a modified version of [VS Code OSS](https://github.com/microsoft/vscode) (v1.106.3), customised as an AI-enabled student coding environment for foundational programming assignments at Ashesi University.

> 🔗 **Repository:** [baaba-midnight/student-ide](https://github.com/baaba-midnight/student-ide)

---

## Prerequisites

Before you can build and run the Student IDE, make sure you have the following installed.

> ⚠️ **Clone into a path with NO spaces.** Native module compilation will fail otherwise.
>
> And switch to the **capstone/1.106.3** branch

### Required Tools

- [Git](https://git-scm.com)
- [Node.js](https://nodejs.org/en/download/prebuilt-binaries) — **x64, version `>=20.x`** (this project uses `v22.x`, see `.node-version`)
- [Python](https://www.python.org/downloads/) — required by `node-gyp` for native modules
  - Ensure `python` runs from the command line without error
  - Install setuptools: `pip install setuptools`
- **C/C++ Build Tools (Windows)** — required for native module compilation

### Installing Build Tools on Windows

Run the following in an **elevated (Admin) terminal**:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--add Microsoft.VisualStudio.Component.Windows11SDK.22621 --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre --add Microsoft.VisualStudio.Component.VC.ATL.Spectre --add Microsoft.VisualStudio.Component.VC.ATLMFC.Spectre"
```

Then configure npm to use Visual Studio 2022:

```powershell
npm config edit
```

Add or update the following line in the config file that opens:

```
msvs_version=2022
```

---

## Getting the Source

Clone the repository:

```powershell
git clone https://github.com/baaba-midnight/student-ide.git
cd student-ide
```

---

## Node.js Version

This project requires a specific version of Node.js. The required version is recorded in `.node-version`. Check your current version:

```powershell
node --version
```

It should return `v22.x.x`. If you need to switch versions, install [`fnm`](https://github.com/Schniz/fnm) and set it up for PowerShell:

```powershell
# Add this to your PowerShell profile ($PROFILE) to initialise fnm automatically
fnm env --shell powershell | Out-String | Invoke-Expression
```

Then in the `student-ide` folder:

```powershell
fnm use
```

---

## Install Dependencies

```powershell
npm install
```

This will trigger the `preinstall` and `postinstall` scripts automatically. The install may take several minutes as it compiles native modules.

**If the install fails**, try cleaning and retrying:

```powershell
git clean -xfd
npm install
```

---

## Build

You have two options:

### Option A — Build inside VS Code (recommended)

Open the `student-ide` folder in VS Code and press `Ctrl`+`Shift`+`B`. This starts the build task in the background. The build is complete when you see `"Finished compilation"` in the task terminal. You can reload it at any time with `Ctrl`+`Shift`+`B` again.

### Option B — Build from the terminal

```powershell
npm run watch
```

This runs both the core watch task and the extension watch task together. It will do a full initial build, then watch for file changes and recompile incrementally.

> The build is ready when you see `"Finished compilation"` in the terminal output. Keep this terminal running while you develop.

---

## Run

Once the build is complete, launch the Student IDE:

```powershell
.\scripts\code.bat
```

> ⚠️ If you see an error saying the app is not a valid Electron app, it means the build hasn't finished yet. Wait for `"Finished compilation"` before running.

---

## Debugging

### Using VS Code

1. Open the `student-ide` folder in VS Code
2. Go to the Debug viewlet (`Ctrl`+`Shift`+`D`)
3. Select the `VS Code` launch configuration from the dropdown
4. Press `F5`

### Using Chrome Developer Tools

Run the `Developer: Toggle Developer Tools` command from the Command Palette inside the running Student IDE to open the Chrome DevTools panel.

To debug the **extension host** (where the StudentChat extension runs):

1. In the Debug viewlet, select `Attach to Extension Host`
2. Press `F5`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails on native modules | Delete `%USERPROFILE%\AppData\Local\node-gyp`, run `git clean -xfd`, then `npm install` again |
| App launches with blank window | Run `.\scripts\code.bat --disable-gpu` |
| `fnm use` throws environment variable error | Add `fnm env --shell powershell \| Out-String \| Invoke-Expression` to your PowerShell `$PROFILE` |
| Build fails after pulling new changes | Run `git clean -xfd` then `npm install` again |
| `"Not a valid Electron app"` error on launch | The build hasn't finished yet — wait for `"Finished compilation"` |
| Spectre-mitigated libraries error | Open Visual Studio Installer and add: MSVC Spectre-mitigated libs, C++ ATL with Spectre Mitigations, C++ MFC with Spectre Mitigations |

---

## Project Structure

```
student-ide/
  src/                        # Core VS Code source (modified)
  extensions/                 # Built-in extensions
    adaptive-ai/              # StudentChat AI assistant extension
  scripts/
    code.bat                  # Launch script (Windows)
  build/                      # Build tooling and scripts
  out/                        # Compiled output (generated)
  .node-version               # Required Node.js version
  package.json                # Dependencies and npm scripts
```

---

## Key npm Scripts

| Script | Description |
|---|---|
| `npm install` | Install all dependencies |
| `npm run watch` | Build and watch for changes (recommended for development) |
| `npm run compile` | One-time full compile |
| `npm run watch-client` | Watch only the core client |
| `npm run watch-extensions` | Watch only the extensions |
| `npm run eslint` | Run the linter |

---

## Related Repositories

This is a submodule of the main capstone project:

| Repo | Description |
|---|---|
| [CAPSTONE_BOA](https://github.com/baaba-midnight/CAPSTONE_BOA) | Main repository (includes all submodules) |
| [capstoneBackend](https://github.com/baaba-midnight/capstoneBackend) | FastAPI backend + LLM orchestration |
| [instructor-dashboard](https://github.com/baaba-midnight/instructor-dashboard) | Instructor web dashboard |