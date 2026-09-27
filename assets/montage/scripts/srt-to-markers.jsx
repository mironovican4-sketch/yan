// SRT → маркеры слоя (After Effects, ExtendScript)
// Как использовать:
//   1. В композиции выдели ОДИН текстовый слой субтитров (он должен начинаться с 0:00).
//   2. File → Scripts → Run Script File… → этот файл → выбери .srt.
//   3. На каждую фразу из SRT появится маркер слоя с текстом фразы в комментарии.
//      Если между фразами пауза больше MAX_GAP, ставится маркер "-" (текст скрывается).
//   Выражения Source Text и Expression Selector из montage-style-guide.md читают эти маркеры.
(function () {
  var MAX_GAP = 0.7; // сек: паузу длиннее этой показываем пустым экраном

  var comp = app.project.activeItem;
  if (!(comp instanceof CompItem) || comp.selectedLayers.length !== 1) {
    alert("Выдели один текстовый слой в активной композиции");
    return;
  }
  var layer = comp.selectedLayers[0];

  var f = File.openDialog("Выбери файл субтитров .srt", "*.srt");
  if (!f) return;
  f.encoding = "UTF-8";
  f.open("r");
  var src = f.read();
  f.close();

  function toSec(s) {
    var m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  }

  var blocks = src.replace(/\r/g, "").split(/\n\s*\n/);
  var markers = layer.property("Marker");
  var prevEnd = null;
  var count = 0;

  app.beginUndoGroup("SRT → markers");
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split("\n");
    var k = 0;
    while (k < lines.length && lines[k].indexOf("-->") < 0) k++;
    if (k >= lines.length) continue;

    var parts = lines[k].split("-->");
    var t0 = toSec(parts[0]);
    var t1 = toSec(parts[1]);
    var text = lines.slice(k + 1).join(" ").replace(/^\s+|\s+$/g, "");
    if (text === "") continue;

    if (prevEnd !== null && t0 - prevEnd > MAX_GAP) {
      markers.setValueAtTime(prevEnd, new MarkerValue("-"));
    }
    markers.setValueAtTime(t0, new MarkerValue(text));
    prevEnd = t1;
    count++;
  }
  if (prevEnd !== null) markers.setValueAtTime(prevEnd, new MarkerValue("-"));
  app.endUndoGroup();

  alert("Готово: " + count + " фраз → маркеры на слое «" + layer.name + "»");
})();
