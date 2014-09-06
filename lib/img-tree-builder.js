﻿var fs = require('fs')
, Promise = require('bluebird')
, TreFile = require('./img-subfile-tre.js')

Promise.promisifyAll(fs);

var readSequenceBlock = function (fd, cursor) {
  var blocks = [];
  var buf = new Buffer(480);
  var seqNumber = 0;
  var num = fs.readSync(fd, buf, 0, 480, cursor);
  for (var i = 0; i < 240; i++) {
    var tmp = buf.readUInt16LE(i * 2);
    if (tmp == 0xffff) break;
    seqNumber = tmp;
    blocks.push(tmp);
  }
  return blocks;
}

var readFatEntry = function (fd, cursor) {
  var cstart = cursor;
  var buf = new Buffer(255);
  var num = 0;

  cursor += num = fs.readSync(fd, buf, 0, 1, cursor);
  var blockType = buf.readUInt8(0);

  cursor += num = fs.readSync(fd, buf, 0, 11);
  var fileName = buf.toString('ascii', 0, 8).trim();
  var fileType = buf.toString('ascii', 8, 11);

  cursor += num = fs.readSync(fd, buf, 0, 20);
  var sizeBytes = buf.readUInt32LE(0);
  var subFileSequence = buf.readUInt16LE(4) >> 8; // I don't know why >> 8

  var blockList = readSequenceBlock(fd, cursor);
  cursor += 480;

  var entry = {
    entryType: blockType,
    fileName: '',
    fileType: '',
    size: 0
  };

  switch (blockType) {
    case 0:
      console.log("FAT entry: dummy block");
      break;

    case 1:
  //    console.log('FAT entry: ' + fileType + ' ' + fileName + ' part ' + subFileSequence + ', size: ' + sizeBytes + ', seq: ' + Math.max.apply(null, blockList));

      entry.fileName = fileName;
      entry.fileType = fileType;
      entry.size = sizeBytes;
      entry.blocks = blockList;
      break;

    default:
      console.log('UNKNOWN FAT BLOCK TYPE ' + blockType);
  }

  return entry;
}

function processFile(fd, imgPath) {
  var imgInfo = {
    path: imgPath
  };

  var buffer = new Buffer(255);
  var num = 0;
  var cursor = 0;

  cursor = 0x10;
  cursor += num = fs.readSync(fd, buffer, 0, 7, cursor);

  cursor = 0x49;
  cursor += num = fs.readSync(fd, buffer, 0, 20, cursor);
  imgInfo.title = buffer.toString('ascii', 0, num).trim();

  cursor = 0x61;
  cursor += num = fs.readSync(fd, buffer, 0, 255, cursor);
  imgInfo.blockSize = (1 << (buffer[0] + buffer[1]));

  var blockOffset = ((imgInfo.blockSize > 2048) ? 0x1000 : 0x400);

  cursor = blockOffset + 0xc;
  cursor += num = fs.readSync(fd, buffer, 0, 10, cursor);
  imgInfo.offset = buffer.readUInt32LE(0);
  imgInfo.fatBlockCount = ((imgInfo.offset - 0x600 /*blockOffset - 0x20*/) / 512);

  cursor = blockOffset + 0x20 + 480;
  var fatEntries = {};

  for (var i = 0; i < imgInfo.fatBlockCount; i++) {
    var entry = readFatEntry(fd, cursor);
    cursor += 512;
    if (entry.entryType == 1) {
      var key = entry.fileType + entry.fileName;
      if (fatEntries[key]) {
        fatEntries[key].blocks = fatEntries[key].blocks.concat(entry.blocks);
      } else {
        fatEntries[key] = entry;
      }
    }
  }

  //   console.log("Offset: " + imgInfo.offset + ', current: ' + cursor);

  var block = [];
  for (var m in fatEntries) {
    var fatEntry = fatEntries[m];
    if (fatEntry.fileType == "TRE") {
      if (imgInfo.tre !== undefined) {
        throw "only expecting one TRE file per disk file";
      }
      imgInfo.tre = TreFile.read(fd, fatEntry, imgInfo.blockSize);
    } else if (fatEntry.fileType == "RGN") {
      if (imgInfo.rgnFAT !== undefined) throw "only expecting one RGN file per disk file";
      imgInfo.rgnFAT = fatEntry;
    } else if (fatEntry.fileType == "LBL") {
      if (imgInfo.lblFAT !== undefined) throw "only expecting one LBL file per disk file";
      imgInfo.lblFAT = fatEntry;
    }    
  }

  fs.close(fd);
  return imgInfo;
}

module.exports = function (imgPath, done) {
  return new Promise(function (resolve, reject) {
    fs.open(imgPath, 'r', function (status, fd) {

      if (status) {
        console.log('ERROR: ' + status.message);
        reject(status);
        return;
      }

      var imgInfo = processFile(fd, imgPath);

      resolve(imgInfo);
    });
  });
}