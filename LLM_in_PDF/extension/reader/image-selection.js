// Render the selected PDF region again at readable resolution, including vector figures.
export function enableImageSelection({ pdf, viewer, container, button, status }) {
  let enabled = false, drag = null, busy = false, previousStatus = '';
  const box = document.createElement('div');
  box.id = 'pdf-image-selection';
  box.hidden = true;
  document.body.appendChild(box);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function cancelDrag() {
    const pointerId = drag?.pointerId;
    drag = null;
    box.hidden = true;
    if (pointerId != null && container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
  }
  function setEnabled(value) {
    cancelDrag();
    if (value && !enabled) previousStatus = status.textContent;
    enabled = value;
    container.classList.toggle('selecting-image', value);
    button.setAttribute('aria-pressed', String(value));
    button.textContent = value ? '取消框选' : '框选图片';
    status.classList.remove('error');
    status.textContent = value ? '在一页内拖框选中图片或图表，松开后预览；按 Esc 取消。' : previousStatus;
  }
  button.disabled = false;
  button.addEventListener('click', () => { if (!busy) setEnabled(!enabled); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && enabled) setEnabled(false); });
  container.addEventListener('scroll', cancelDrag);
  window.addEventListener('resize', cancelDrag);
  container.addEventListener('pointerdown', (event) => {
    if (!enabled || busy || event.button !== 0) return;
    const pageElement = event.target.closest('.page[data-page-number]');
    const rect = pageElement?.querySelector('.canvasWrapper')?.getBoundingClientRect();
    if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.preventDefault(); event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    drag = { rect, page: Number(pageElement.dataset.pageNumber), x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    container.setPointerCapture(event.pointerId);
  }, true);
  function rectangle(event) {
    const { rect, x, y } = drag;
    const endX = clamp(event.clientX, rect.left, rect.right), endY = clamp(event.clientY, rect.top, rect.bottom);
    return { left: Math.min(x, endX), top: Math.min(y, endY), width: Math.abs(endX - x), height: Math.abs(endY - y) };
  }
  container.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const selected = rectangle(event);
    Object.assign(box.style, { left: `${selected.left}px`, top: `${selected.top}px`, width: `${selected.width}px`, height: `${selected.height}px` });
    box.hidden = false;
  }, true);
  container.addEventListener('pointercancel', cancelDrag);
  container.addEventListener('lostpointercapture', cancelDrag);
  container.addEventListener('pointerup', async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const selected = rectangle(event), { rect, page: pageNumber } = drag;
    cancelDrag();
    if (selected.width < 8 || selected.height < 8) { status.textContent = '选区太小，请拖框选中完整图片或图表。'; return; }
    setEnabled(false);
    busy = true; button.disabled = true;
    status.textContent = '正在提取选中的图片…';
    try {
      const page = await pdf.getPage(pageNumber);
      const rotation = viewer.getPageView(pageNumber - 1).viewport.rotation;
      const unit = page.getViewport({ scale: 1, rotation });
      const region = { x: (selected.left - rect.left) / rect.width, y: (selected.top - rect.top) / rect.height,
        width: selected.width / rect.width, height: selected.height / rect.height };
      const longest = Math.max(unit.width * region.width, unit.height * region.height);
      const scale = Math.min(3, 1800 / longest);
      const viewport = page.getViewport({ scale, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width * region.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height * region.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport,
        transform: [1, 0, 0, 1, -viewport.width * region.x, -viewport.height * region.y], background: '#fff' }).promise;
      let dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > 4 * 1024 * 1024) dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      if (dataUrl.length > 4 * 1024 * 1024) throw new Error('图片过大，请缩小框选范围。');
      const image = { id: crypto.randomUUID(), name: `PDF 第 ${pageNumber} 页截图`, page: pageNumber,
        width: canvas.width, height: canvas.height, dataUrl };
      canvas.width = canvas.height = 0;
      window.dispatchEvent(new CustomEvent('paper-read-image', { detail: image }));
      status.textContent = '图片已加入右侧提问框，输入问题后发送。';
    } catch (error) {
      status.classList.add('error'); status.textContent = `图片提取失败：${error.message}`;
    } finally { busy = false; button.disabled = false; }
  }, true);
}
