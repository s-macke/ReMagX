#pragma once
#include <errno.h>
#define __set_errno(value) (errno = (value))
#ifndef __always_inline
#define __always_inline inline
#endif
