@echo off
rem Double-click to publish: builds the game and pushes it to GitHub Pages (1-2 min to go live).
cd /d "%~dp0"
echo Building...
call npm run build || goto :fail
echo Publishing to GitHub Pages...
call npx gh-pages -d dist --nojekyll -m "deploy %date% %time%" || goto :fail
git add -A
git commit -q -m "update %date% %time%"
git push -q
echo.
echo Done. The site updates in 1-2 minutes.
pause
exit /b
:fail
echo.
echo FAILED. Check the messages above.
pause
