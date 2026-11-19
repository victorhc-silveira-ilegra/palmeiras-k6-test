#!/usr/bin/env python3
"""Monitora a topologia descoberta até o ALB publicar um 504."""

import os
from pathlib import Path
import sys

if __name__ == "__main__":
    os.execv(sys.executable, [
        sys.executable, str(Path(__file__).with_name("hml_telemetry.py")),
        "--watch", "--stop-on-504", *sys.argv[1:],
    ])
