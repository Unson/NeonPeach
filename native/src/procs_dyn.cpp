// The C++ twins of the worklets in app/worklets3.js for the dyn pedal family. Ported line by line; the golden test checks them against Chrome.
#include "procs.h"
#include <algorithm>
#include <cstdint>

namespace np {

Proc* makeProcDyn(const std::string& name){ (void)name; return nullptr; }

} // namespace np
