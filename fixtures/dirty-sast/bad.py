import os, subprocess
def run(user_input, cmd):
    eval(user_input)                       # arbitrary code execution
    os.system(cmd)                         # command injection
    subprocess.run(cmd, shell=True)        # command injection
