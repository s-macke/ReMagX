import ctypes


class NativeTable:
    def __init__(self, library):
        self.library = library
        library.remagx_table_lookup.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double),
            ctypes.c_size_t, ctypes.c_size_t, ctypes.POINTER(ctypes.c_double), ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_double)]
        library.remagx_table_lookup.restype = ctypes.c_int

    def lookup(self, energies, rows, queries, cursor=0, columns=2):
        array = lambda values: (ctypes.c_double * len(values))(*values)
        energy_array, values, inputs = array(energies), array([value for row in rows for value in row]), array(queries)
        position = ctypes.c_size_t(cursor)
        output = array([-123.] * (len(queries) * columns))
        before = bytes(energy_array), bytes(values), bytes(inputs)
        status = self.library.remagx_table_lookup(energy_array, values, len(energies), columns, inputs, len(queries), ctypes.byref(position), output)
        if before != (bytes(energy_array), bytes(values), bytes(inputs)):
            raise AssertionError('Table lookup mutated input')
        return status, list(output), position.value
