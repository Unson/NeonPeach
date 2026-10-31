#!/bin/sh
# Cross-builds build/win32-x64/npaudio.node with MinGW-w64 (ASIO + WASAPI + DirectSound).
set -e
cd "$(dirname "$0")"; mkdir -p build/win32-x64 build/obj-win
CXX=x86_64-w64-mingw32-g++-posix; CC=x86_64-w64-mingw32-gcc-posix
INC="-Isrc -Ithird_party/rtaudio -Ithird_party/rtaudio/include -Inode_modules/node-api-headers/include -Inode_modules/node-addon-api"
DEF="-DNAPI_VERSION=8 -D__WINDOWS_ASIO__ -D__WINDOWS_WASAPI__ -D__WINDOWS_DS__ -D_USE_MATH_DEFINES -DNOMINMAX -DUNICODE -D_UNICODE"
CXXF="-O3 -std=c++17 $DEF -Wno-attributes -Wno-unused-function -Wno-misleading-indentation -Wno-deprecated-declarations"
for f in src/context.cpp src/nodes.cpp src/procs.cpp src/procs_drive.cpp src/procs_dyn.cpp src/procs_mod.cpp src/procs_time.cpp src/nam.cpp src/convolver.cpp src/addon.cpp third_party/rtaudio/RtAudio.cpp third_party/rtaudio/include/asio.cpp third_party/rtaudio/include/asiodrivers.cpp third_party/rtaudio/include/asiolist.cpp third_party/rtaudio/include/iasiothiscallresolver.cpp; do
  o=build/obj-win/$(basename $f .cpp).o
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ] || [ src/np.h -nt "$o" ] || [ src/procs.h -nt "$o" ]; then $CXX $CXXF $INC -c $f -o $o & fi
done
$CC -O2 -c src/win_napi_stubs.c -o build/obj-win/win_napi_stubs.o &
wait
$CXX -shared -o build/win32-x64/npaudio.node build/obj-win/*.o -static -static-libgcc -static-libstdc++ -lole32 -lwinmm -ldsound -lksuser -lmfplat -lmfuuid -lwmcodecdspuuid -luuid -luser32 -ladvapi32 -Wl,--enable-stdcall-fixup
x86_64-w64-mingw32-strip build/win32-x64/npaudio.node
echo built build/win32-x64/npaudio.node
