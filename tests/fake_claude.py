"""測試用假 claude：記錄 argv，睡一會兒後結束。"""

import os
import sys
import time

log = os.environ.get("FAKE_CLAUDE_LOG")
if log:
    with open(log, "a", encoding="utf-8") as f:
        f.write(" ".join(sys.argv[1:]) + "\n")
time.sleep(float(os.environ.get("FAKE_CLAUDE_SLEEP", "0")))
sys.exit(0)
