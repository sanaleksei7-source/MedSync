// AudioWorklet: передаёт в основной поток блоки звука с микрофона. Больше ничего не делает и ничего не сохраняет.
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
