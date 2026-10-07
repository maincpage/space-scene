@echo off
chcp 65001 >nul
for %%F in (index.html app.js styles.css scene-math.js image-files.js mesh-math.js mesh-renderer.js layer-editor.js server.cjs project-store.cjs start.ps1) do (
  if not exist "%~dp0%%F" goto missing
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
exit /b
:missing
echo 请先将压缩包“全部解压”，再运行启动文件。
echo 不要在压缩包里直接运行这个 CMD 文件。
echo index.html、JS 和 CSS 文件需要保留在同一个项目文件夹中。
pause
