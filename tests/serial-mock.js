function crc16(data) {
  var table = new Uint16Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i;
    for (var j = 0; j < 8; j++) {
      c = (c & 1) ? (c >> 1) ^ 0xA001 : c >> 1;
    }
    table[i] = c;
  }
  var crc = 0xFFFF;
  for (var k = 0; k < data.length; k++) {
    crc = (crc >> 8) ^ table[(crc ^ data[k]) & 0xFF];
  }
  return crc;
}

var deferredData = [];
var accessCount = 0;

var mockPort = {
  get readable() {
    accessCount++;
    if (accessCount === 1) {
      return new ReadableStream({ start: function(c) { c.close(); } });
    }
    return new ReadableStream({
      start: function(c) {
        while (deferredData.length > 0) c.enqueue(deferredData.shift());
      }
    });
  },
  writable: new WritableStream({
    write: function(chunk) {
      var frame = new Uint8Array(chunk);
      if (frame.length >= 2) {
        if (frame[1] === 0x03) {
          var resp = new Uint8Array([frame[0], 0x03, 0x02, 0x12, 0x34]);
          var c = crc16(resp);
          var full = [];
          for (var i = 0; i < resp.length; i++) full.push(resp[i]);
          full.push(c & 0xFF);
          full.push((c >> 8) & 0xFF);
          deferredData.push(new Uint8Array(full));
        } else if (frame[1] === 0x10) {
          var resp2 = new Uint8Array([frame[0], 0x10, frame[2], frame[3], 0x00, 0x01]);
          var c2 = crc16(resp2);
          var full2 = [];
          for (var j = 0; j < resp2.length; j++) full2.push(resp2[j]);
          full2.push(c2 & 0xFF);
          full2.push((c2 >> 8) & 0xFF);
          deferredData.push(new Uint8Array(full2));
        }
      }
    }
  }),
  open: function() { return Promise.resolve(); },
  close: function() { return Promise.resolve(); },
  getInfo: function() { return { usbVendorId: 0x1234, usbProductId: 0x5678 }; }
};

navigator.serial = {
  requestPort: function() { return Promise.resolve(mockPort); },
  getPorts: function() { return Promise.resolve([mockPort]); }
};
