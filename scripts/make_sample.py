from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED
from pathlib import Path
from html import escape
chapters = [
('序言 · 为自己留一页', [
'慢读时光',
'我们每天读很多文字。消息、邮件、匆匆掠过的标题，把一天切成很小的碎片。有时候，一整天过去了，却想不起哪一句话真正留在心里。',
'这本小书邀请你做一件简单的事：放慢一点。无须设定目标，无须统计速度。只要找到一个舒服的位置，翻开这一页。',
'窗外的光落在桌面上，杯中的水还温着。此刻，不必赶往任何地方。',
'ZheReader 是一处安静的阅读空间。你可以导入自己的 PDF 和 EPUB，在这里继续尚未读完的故事。阅读进度会自动保存在当前浏览器里。',
'这是 ZheReader 专门为你写的一本体验小书。试试下方的翻页按钮，或按键盘左右方向键，开始下一页。']),
('第一章 · 窗边的光', [
'窗边的光',
'清晨的房间里，最先醒来的是光。它沿着窗框缓慢移动，在地板上画出一块不规则的方形。你把椅子挪过去，让书页也分到一点温暖。',
'阅读并不总是需要准备齐全。有一本书，有十分钟，有暂时放下手机的决心，就足够了。',
'我们习惯把注意力借给外面的世界。每一个提示音，都是一次轻轻的敲门。阅读的时候，可以暂时不去应门。文字会等你，故事也会。',
'试着慢慢读一个段落。读到喜欢的句子，停一停。不急着理解全部的意思，也不急着翻到下一页。让那句话在心里坐一会儿。',
'你可能会想到很久没有见过的人，某个下午经过的街角，或者小时候读过的一本书。这些看似与阅读无关的念头，其实也是阅读的一部分。',
'书里的世界和你的世界，就在这一刻相遇。',
'如果想记住这里，点击顶部的书签图标。下次打开目录与书签，就可以回到这页。']),
('第二章 · 在字里行间散步', [
'在字里行间散步',
'有人把阅读比作旅行。可我们不必总是去很远的地方。有时，阅读更像在熟悉的街区散步：同一条路，今天走过，又发现一处从前没有留意的风景。',
'一本读过的书，也会随着我们改变。曾经觉得平常的句子，多年以后再读，忽然有了重量。并不是纸上的字变了，是我们带着新的生活回来。',
'所以，不必为忘记书里的内容感到遗憾。那些文字也许没有成为随时可以引用的知识，却慢慢改变了你看待世界的方式。',
'你开始更有耐心地听一个人说话，开始注意树叶在不同季节里的颜色，开始允许自己对暂时没有答案的问题保持好奇。',
'这些细小的变化，没有页码，也不在目录里。但它们确实发生过。',
'把阅读当作散步，就不必每次都带回什么。走过的路，呼吸过的空气，已经是收获。',
'如果文字偏小，可以使用右下角的加号调整字号。这里没有规定好的阅读姿势，舒服就好。']),
('第三章 · 夜色也是一张书签', [
'夜色也是一张书签',
'晚上八点，窗外的声音逐渐变轻。灯光聚成一个小小的圆，把白天尚未完成的事情暂时留在圆外。',
'ZheReader 会按照设备的本地时间，在晚上八点切换为深色主题，早晨七点回到温暖的浅色。你也可以通过顶部的主题按钮，选择自己喜欢的氛围。',
'夜晚适合读一些不需要匆忙读完的文字。它们像慢慢降落的雨，落在白天被晒得发硬的心情上。',
'今天也许有一些没有完成的计划，有一些说得不够好的话。没有关系。先读几页书，然后好好休息。世界不会因为你暂停片刻而停止转动。',
'把书合上的时候，不必为故事尚未结束而着急。明天还有一页，后天也还有。阅读的美好，有一部分正在于它总是允许我们回来。',
'愿你在很多普通的日子里，都能找到这样一小段时间。',
'一页，一页。慢慢读，也慢慢生活。'])]
with ZipFile('public/sample.epub','w') as z:
 z.writestr('mimetype','application/epub+zip',compress_type=ZIP_STORED)
 z.writestr('META-INF/container.xml','''<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''',compress_type=ZIP_DEFLATED)
 manifest=''.join(f'<item id="ch{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))
 spine=''.join(f'<itemref idref="ch{i}"/>' for i in range(len(chapters)))
 z.writestr('OEBPS/content.opf',f'''<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:zhereader:slow-reading:1</dc:identifier><dc:title>慢读时光</dc:title><dc:creator>ZheReader 编辑室</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-09-13T00:00:00Z</meta></metadata><manifest>{manifest}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine>{spine}</spine></package>''')
 nav=''.join(f'<li><a href="ch{i}.xhtml">{escape(title)}</a></li>' for i,(title,_) in enumerate(chapters))
 z.writestr('OEBPS/nav.xhtml',f'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>{nav}</ol></nav></body></html>''')
 for i,(title,paras) in enumerate(chapters):
  body=f'<h1>{escape(paras[0])}</h1>'+''.join(f'<p>{escape(p)}</p>' for p in paras[1:])
  z.writestr(f'OEBPS/ch{i}.xhtml',f'''<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>{escape(title)}</title><style>body{{font-family:serif;line-height:1.9}}h1{{font-size:1.6em;font-weight:500;margin:1.5em 0}}p{{text-indent:2em;margin:1em 0}}</style></head><body>{body}</body></html>''')
