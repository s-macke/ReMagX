import random


def synthetic_table_cases():
    generator = random.Random(26019)
    for case in range(80):
        columns = [1, 2, 18, 20][case % 4]
        energies = sorted(generator.randint(1, 10) for _ in range(case % 21))
        rows = [[generator.uniform(-1e3, 1e3) for _ in range(columns)] for _ in energies]
        queries = [generator.uniform(0, 11) for _ in range(10)] + [2, 2, 2, 5, 5, 5, 1, 10]
        cursor = generator.choice([0, len(energies) + 20])
        yield dict(energy=energies, columns=[[row[column] for row in rows] for column in range(columns)], queries=queries, cursor=cursor)
