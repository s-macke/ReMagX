import { useRef } from 'react'
import { useAppState, useDispatch } from '../state/context'

export function ValueSlider() {
  const { valueSlider } = useAppState()
  const dispatch = useDispatch()
  const gesture = useRef(0)
  return <div className="value-slider">
    <input type="range" aria-label="Selected cell value" aria-description={valueSlider ? `${valueSlider.label}; 250 is the selected value, 1000 is four times that value.` : 'Select a numeric cell to enable the slider.'}
      min={0} max={1000} step={1} value={valueSlider?.position ?? 250} disabled={!valueSlider}
      onPointerDown={() => { gesture.current++ }}
      onKeyDown={event => { if (!event.repeat) gesture.current++ }}
      onChange={event => dispatch({ type: 'slideValue', position: Number(event.target.value), coalesce: `value-slider:${gesture.current}` })} />
    <span>{valueSlider ? `${valueSlider.label} · ${valueSlider.position / 250}×` : 'Select a numeric cell'}</span>
  </div>
}
