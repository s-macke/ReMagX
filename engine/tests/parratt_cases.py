import math
import random


def synthetic_cases():
    generator = random.Random(26017)
    for case in range(120):
        tensor = case % 2
        analyzer = case % 3
        beam = generator.choice([(1, 0, 0, 0), (0, 0, 1, 0), (.3, .4, .6, .8), (0, math.sqrt(.5), math.sqrt(.5), 0)])
        layers = [(generator.uniform(0, 150), generator.choice([0, generator.uniform(0, 8)]),
                   generator.uniform(-.002, .015), generator.uniform(.001, .003), generator.uniform(-.0003, .0003),
                   generator.uniform(-.0001, .0001), generator.uniform(-180, 180), generator.uniform(-180, 180))
                  for _ in range(generator.randint(2, 18))]
        layers[-1] = (0, 0, 0, 0, 0, 0, 90, 90)
        points = [(angle, wave, magnetic) for angle in [-.03, 0, 1e-8, .005, .1, math.pi/2]
                  for wave in [.05, 1] for magnetic in [-1, 0, 1]]
        yield dict(layers=layers, points=points, beam=beam, tensor=tensor, analyzer=analyzer)


