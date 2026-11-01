import os

# torch's optimizer step opens a CUDA context whenever a GPU is visible, even for a model on the CPU, so the tests
# fail with "out of memory" while another job fills the card. They train on the CPU anyway, as CI does.
os.environ["CUDA_VISIBLE_DEVICES"] = ""
