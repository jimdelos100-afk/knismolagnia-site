export default function WorkTemplateExample({ level }: { level: number }) {
  return <details className="panel work-template">
    <summary>查看作品发表模板示例</summary>
    <div className="work-template-card">
      <div className="work-cover-placeholder"><span>COVER</span><b>♡</b></div>
      <div><small>Level {level} 作品示例</small><h2>作品标题示例</h2><p><b>作者：</b>作者或汉化组名称　<b>页数：</b>128 页</p><p><b>简介：</b>用简洁文字说明作品主题、内容特色和适合的读者，建议控制在 80—300 字。</p><div className="work-tags"><span>#汉化作品</span><span>#示例标签</span><span>#已完结</span></div></div>
    </div>
  </details>
}
