"""Model 1 pure core.

Nothing in this package may import a third-party module. It runs on the
developer's local Python 3.14, where PyTorch and Ultralytics wheels do
not exist - that is the whole point of the split. Anything needing a GPU
lives in `scripts/`, which only ever runs on Colab.
"""

__version__ = "1.0.0"
