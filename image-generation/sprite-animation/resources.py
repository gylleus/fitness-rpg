"""Low-frequency measurements for owned inference subprocesses."""
import json
from pathlib import Path
import subprocess
import threading
import time

import psutil

from common import save_json


class ProcessMonitor:
    def __init__(self, pid, output):
        self.pid = pid
        self.output = Path(output)
        self.samples = []
        self.stop_event = threading.Event()
        self.started = time.monotonic()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()

    def sample(self):
        with self.output.with_suffix(".jsonl").open("w") as log:
            while not self.stop_event.is_set():
                record = {"seconds": round(time.monotonic() - self.started, 2)}
                try:
                    process = psutil.Process(self.pid)
                    record["process_rss_MiB"] = process.memory_info().rss / 2**20
                    record["system_available_RAM_MiB"] = psutil.virtual_memory().available / 2**20
                    record["system_swap_used_MiB"] = psutil.swap_memory().used / 2**20
                    query = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used,utilization.gpu",
                        "--format=csv,noheader,nounits", "-i", "0"], timeout=5).decode().strip().split(",")
                    record["whole_GPU_used_MiB"] = float(query[0])
                    record["whole_GPU_utilization_percent"] = float(query[1])
                except (psutil.Error, subprocess.SubprocessError, OSError, ValueError) as exc:
                    record["measurement_error"] = str(exc)
                self.samples.append(record)
                log.write(json.dumps(record) + "\n")
                log.flush()
                self.stop_event.wait(5)

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=7)
        summary = {"seconds": time.monotonic() - self.started, "samples": len(self.samples),
                   "sampling_interval_seconds": 5,
                   "note": "Sampled peaks, not allocation maxima. GPU totals include other applications; RSS is the owned process only."}
        for key in ("process_rss_MiB", "whole_GPU_used_MiB", "system_swap_used_MiB"):
            values = [r[key] for r in self.samples if key in r]
            summary["peak_" + key] = max(values) if values else None
        values = [r["system_available_RAM_MiB"] for r in self.samples if "system_available_RAM_MiB" in r]
        summary["minimum_system_available_RAM_MiB"] = min(values) if values else None
        save_json(self.output, summary)
