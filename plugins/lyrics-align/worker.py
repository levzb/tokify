# Lyrics alignment worker — a placeholder. Tokify sends one JSON object on stdin and reads one from stdout.
import json
import platform
import sys

job = json.load(sys.stdin)
if job.get("ping"):
    print(json.dumps({"ok": True, "python": platform.python_version()}))
else:
    print(json.dumps({"ok": False, "error": "not built yet"}))
