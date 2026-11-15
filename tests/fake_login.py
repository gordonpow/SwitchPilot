"""假的 `claude auth login`：依 CLAUDE_CONFIG_DIR 寫出憑證檔。

用法：fake_login.py [ok|fail|nocreds|sleep]
"""
import json
import os
import sys
import time

mode = sys.argv[1] if len(sys.argv) > 1 else "ok"
d = os.environ["CLAUDE_CONFIG_DIR"]
print("If the browser didn't open, visit: https://example.test/fallback?x=1", flush=True)
if mode == "sleep":
    time.sleep(60)
elif mode == "fail":
    print("login failed", flush=True)
    sys.exit(1)
elif mode == "nocreds":
    with open(os.path.join(d, "other.txt"), "w") as f:
        f.write("x")
else:
    with open(os.path.join(d, ".credentials.json"), "w") as f:
        json.dump({"claudeAiOauth": {"accessToken": "fa", "refreshToken": "fr"}}, f)
    with open(os.path.join(d, ".claude.json"), "w") as f:
        json.dump({"oauthAccount": {"accountUuid": "fu", "emailAddress": "fake@x"}}, f)
sys.exit(0)
