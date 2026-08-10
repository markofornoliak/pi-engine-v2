#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/.build"
GMP_VERSION="6.3.0"
GMP_SRC="$BUILD/gmp-$GMP_VERSION"
GMP_PREFIX="$BUILD/gmp-wasm"
OUT="$ROOT/wasm"

mkdir -p "$BUILD" "$OUT"

if [[ ! -f "$GMP_PREFIX/lib/libgmp.a" ]]; then
  cd "$BUILD"
  if [[ ! -f "gmp-$GMP_VERSION.tar.xz" ]]; then
    curl --retry 4 --retry-delay 2 --fail --location --output "gmp-$GMP_VERSION.tar.xz" \
      "https://ftp.gnu.org/gnu/gmp/gmp-$GMP_VERSION.tar.xz"
  fi
  rm -rf "$GMP_SRC"
  tar -xf "gmp-$GMP_VERSION.tar.xz"
  cd "$GMP_SRC"
  emconfigure ./configure \
    --host=none-none-none \
    --disable-shared \
    --enable-static \
    --disable-assembly \
    --prefix="$GMP_PREFIX"
  emmake make -j2
  emmake make install
fi

COMMON=(
  "$ROOT/native/pi_engine.cpp"
  "$GMP_PREFIX/lib/libgmp.a"
  -I"$GMP_PREFIX/include"
  -std=c++20
  -O3
  -flto
  -msimd128
  -sWASM=1
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=worker
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=4294967296
  -sFILESYSTEM=0
  -sASSERTIONS=0
  -sEXPORTED_FUNCTIONS='["_pi_compute","_pi_free","_pi_terms_done","_pi_terms_total","_pi_max_threads"]'
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString"]'
)

em++ "${COMMON[@]}" -o "$OUT/pi_engine_st.js"

em++ "${COMMON[@]}" \
  -pthread \
  -sPTHREAD_POOL_SIZE='Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4))' \
  -sMALLOC=mimalloc \
  -o "$OUT/pi_engine_mt.js"

ls -lh "$OUT"
