(function (root) {
  'use strict';
  function prepareFiles(input) {
    const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (files.some(file => !/^\d{2}\.png$/.test(file.name))) throw new Error('图片必须是 PNG，文件名使用 00.png、01.png、02.png 这样的两位数字格式。');
    if (new Set(files.map(file => file.name)).size !== files.length) throw new Error('图片文件名不能重复，请选择同一组素材。');
    if (files.length < 2 || files.length > 21) throw new Error('请选择 00.png 整图和 1～20 张分层 PNG。');
    if (files[0].name !== '00.png' || files[1].name !== '01.png') throw new Error('必须包含 00.png 整图和 01.png 最底层图片。');
    if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0)) throw new Error('图片文件为空或大小无效。');
    const folders = new Set(files.map(file => (file.webkitRelativePath || file.name).replace(/[^/]+$/, '')));
    if (folders.size > 1) throw new Error('请选择同一个项目文件夹内的图片，不要包含子文件夹。');
    if (files.reduce((sum, file) => sum + file.size, 0) > 150 * 1024 * 1024) throw new Error('图片合计超过 150 MB，请缩小后再导入。');
    const id = JSON.stringify(files.map(file => [file.name, file.size, file.lastModified ?? 0]));
    return { files, overview: files[0], layers: files.slice(1), id };
  }
  const api = { prepareFiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImageFiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
