#include "remagx/core.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <vector>

extern "C" int remagx_table_lookup(const double* energies, const double* values, size_t row_count,
                       size_t column_count, const double* queries, size_t query_count,
                       size_t* cursor, double* output) {
    if (!column_count || column_count > 20 || !queries || !query_count || !cursor || !output ||
        (row_count && (!energies || !values))) return REMAGX_INVALID_ARGUMENT;
    if (row_count > std::numeric_limits<size_t>::max() / column_count ||
        query_count > std::numeric_limits<size_t>::max() / column_count) return REMAGX_ALLOCATION_ERROR;
    for (size_t row = 0; row < row_count; ++row) {
        if (!std::isfinite(energies[row]) || (row && energies[row] < energies[row - 1])) return REMAGX_INVALID_ARGUMENT;
    }
    for (size_t index = 0; index < row_count * column_count; ++index)
        if (!std::isfinite(values[index])) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < query_count; ++index)
        if (!std::isfinite(queries[index])) return REMAGX_INVALID_ARGUMENT;
    try {
        std::vector<double> result(query_count * column_count, 0.0);
        size_t position = *cursor;
        for (size_t query = 0; query < query_count; ++query) {
            if (!row_count) continue;
            const double energy = queries[query];
            // CTable::Get tests exact first, then exact last, then range exclusion.
            if (energy == energies[0] || energy == energies[row_count - 1]) {
                const size_t row = energy == energies[0] ? 0 : row_count - 1;
                std::copy_n(values + row * column_count, column_count, result.data() + query * column_count);
                continue;
            }
            if (energy < energies[0] || energy > energies[row_count - 1]) continue;
            if (position >= row_count) position = 0;
            if (energy > energies[position]) {
                while (energy > energies[position]) ++position;
            } else {
                while (energy < energies[position]) --position;
                ++position;
            }
            double distance = energies[position] - energies[position - 1];
            if (distance == 0.0) distance = 1e-5;
            for (size_t column = 0; column < column_count; ++column) {
                const double lower = values[(position - 1) * column_count + column];
                const double upper = values[position * column_count + column];
                const double value = lower + (upper - lower) * ((energy - energies[position - 1]) / distance);
                if (!std::isfinite(value)) return REMAGX_NUMERICAL_ERROR;
                result[query * column_count + column] = value;
            }
        }
        std::copy(result.begin(), result.end(), output);
        *cursor = position;
        return REMAGX_SUCCESS;
    } catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
