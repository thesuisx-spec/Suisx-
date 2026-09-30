#!/usr/bin/env bash
# Packs the dictionary into Lexikon-Windows.zip (unzip, double-click Start-Lexikon.bat).
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf /tmp/lexpkg && mkdir -p /tmp/lexpkg/Lexikon
cp Start-Lexikon.bat /tmp/lexpkg/Lexikon/
cp dictionary/tools/README-Windows.txt /tmp/lexpkg/Lexikon/README.txt
cp -r dictionary /tmp/lexpkg/Lexikon/
rm -f /tmp/lexpkg/Lexikon/dictionary/tools/build_dict.py /tmp/lexpkg/Lexikon/dictionary/tools/package_windows.sh
(cd /tmp/lexpkg && zip -qr -X Lexikon-Windows.zip Lexikon)
mv /tmp/lexpkg/Lexikon-Windows.zip .
ls -lh Lexikon-Windows.zip
