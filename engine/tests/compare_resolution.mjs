// Cross-check the native port against the independently reviewed worker implementation.
import { readFileSync } from 'node:fs'
import { angularResolutionCoordinates, combineAngularResolution } from '../../app/src/model/angularResolution.ts'
const input = JSON.parse(readFileSync(0, 'utf8'))
console.log(JSON.stringify(input.map(item => ({
  coordinates: angularResolutionCoordinates(item.qz, item.width, item.fast),
  values: Array.from(combineAngularResolution(item.qz, new Float64Array(item.raw), item.width, item.fast, item.dichroic)),
}))))
