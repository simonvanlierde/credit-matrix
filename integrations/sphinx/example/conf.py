"""Build the example with the repository's extension and CLI."""

import sys
from pathlib import Path

here = Path(__file__).parent
sys.path.insert(0, str(here.parent))
extensions = ["credit_matrix"]
project = "Example Lab"
credit_matrix_command = ["node", str(here.parents[2] / "src/core/dist/cli.js")]
