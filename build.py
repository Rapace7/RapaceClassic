# -*- coding: utf-8 -*-
"""把 src/ 下的所有文件内联成一个自包含的 HTML 单文件。

产物：项目根目录下的「玄清棋典.html」
特点：双击即开，不联网、不需要安装任何东西、不依赖 AI 大模型。

用法：
    python build.py            # 生成 玄清棋典.html
    python build.py -o 别的名字.html
"""
import base64
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
DEFAULT_OUT = '玄清棋典.html'


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def guard_script(js):
    """防止 JS 里出现 </script> 把 HTML 提前截断。"""
    return js.replace('</script', '<\\/script')


def build(out_name=DEFAULT_OUT):
    html = read(os.path.join(SRC, 'index.html'))
    inlined = []

    # 1) 内联 CSS
    css_files = re.findall(r'<link[^>]+href="([^"]+\.css)"[^>]*>', html)
    for css in css_files:
        path = os.path.join(SRC, css)
        if not os.path.exists(path):
            raise SystemExit('缺少样式文件：%s' % path)
        content = read(path)
        # CSS 里如果出现 </style> 同样要挡掉
        content = content.replace('</style', '<\\/style')
        html = html.replace('<link rel="stylesheet" href="%s">' % css,
                            '<style>\n/* ===== %s ===== */\n%s\n</style>' % (css, content))
        inlined.append(('css', css, len(content)))

    # 2) 内联 JS（顺序必须与原文件一致：数据 → 逻辑）
    js_files = re.findall(r'<script src="([^"]+\.js)"></script>', html)
    for js in js_files:
        path = os.path.join(SRC, js)
        if not os.path.exists(path):
            raise SystemExit('缺少脚本文件：%s' % path)
        content = read(path)
        html = html.replace('<script src="%s"></script>' % js,
                            '<script>\n/* ===== %s ===== */\n%s\n</script>'
                            % (js, guard_script(content)))
        inlined.append(('js', js, len(content)))

    # 3) 内联图标（favicon）—— 单文件必须是自包含的，外部图片会丢
    icon_files = re.findall(r'<link[^>]+rel="icon"[^>]+href="([^"]+\.png)"[^>]*>', html)
    for icon in icon_files:
        path = os.path.join(SRC, icon)
        if not os.path.exists(path):
            print('提示：找不到图标 %s，跳过内联（页面会用默认图标）' % path)
            continue
        with open(path, 'rb') as f:
            raw = f.read()
        html = html.replace('href="%s"' % icon,
                            'href="data:image/png;base64,%s"'
                            % base64.b64encode(raw).decode('ascii'))
        inlined.append(('icon', icon, len(raw)))

    # 4) 标注产物信息（方便日后确认是哪个版本打的包）
    html = html.replace('</title>',
                        '</title>\n<!-- 由 build.py 打包生成：%d 个文件内联 -->' % len(inlined))

    out_path = os.path.join(ROOT, out_name)
    with io.open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)

    size = os.path.getsize(out_path)
    print('已生成：%s' % out_path)
    print('大小：%.2f MB' % (size / 1048576.0))
    print('内联：%d 个文件' % len(inlined))
    for kind, name, n in inlined:
        print('   %-4s %-22s %8.1f KB' % (kind, name, n / 1024.0))
    return out_path


if __name__ == '__main__':
    name = DEFAULT_OUT
    if '-o' in sys.argv:
        name = sys.argv[sys.argv.index('-o') + 1]
    build(name)
