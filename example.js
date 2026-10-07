// 仅供“加载示例”按钮使用，不会自动加载。
window.SPATIAL_EXAMPLE = {
  id: 'example', width: 2480, height: 3508, background: '#000000', strength: 60,
  overview: './图/try01/00.png',
  layers: ['01', '02', '03', '04', '05'].map((id, index) => ({
    id: `${id}.png`, name: `${id}.png`, src: `./图/try01/${id}.png`, depth: index / 4
  }))
};
