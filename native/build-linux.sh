#!/bin/sh
# Builds build/linux-x64/npaudio.node (Node-API, works in Node and Electron).
set -e
cd "$(dirname "$0")"; OUT=${NP_OUT:-build/linux-x64}; OBJ=${NP_OBJ:-build/obj-linux}; mkdir -p $OUT $OBJ
INC="-Isrc -Ithird_party/rtaudio -Inode_modules/node-api-headers/include -Inode_modules/node-addon-api"
CXXF="-O3 -std=c++17 -fPIC -fvisibility=hidden -DNAPI_VERSION=8 -D__LINUX_ALSA__ -Wall -Wno-unused-function -Wno-misleading-indentation"
for f in src/context.cpp src/nodes.cpp src/procs.cpp src/procs_drive.cpp src/procs_dyn.cpp src/procs_mod.cpp src/procs_time.cpp src/nam.cpp src/convolver.cpp src/addon.cpp third_party/rtaudio/RtAudio.cpp; do
  o=$OBJ/$(basename $f .cpp).o
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ] || [ src/np.h -nt "$o" ] || [ src/procs.h -nt "$o" ]; then g++ $CXXF $INC -c $f -o $o & fi
done; wait
g++ -shared -o $OUT/npaudio.node $OBJ/*.o -lasound -lpthread
echo built $OUT/npaudio.node
