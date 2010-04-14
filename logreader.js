var fs = require('fs');
var url = require('url');
var querystring = require('querystring');
var sys = require('sys');

exports.class = function(filename){
	this.buffer = [];
	this.callbackQueue = [];
	this.afterOpen = [];
	this.filename = filename;
	this.buf = '';
	var reader = this;
	this.open();
};

exports.class.prototype.open = function(callback){
	if (typeof(this.fd) != 'undefined') {
		if (callback) callback();
		return;
	}
	if (callback) this.afterOpen.push(callback);
	fs.open(this.filename, 'r', 0, function(err, descriptor){
		if (err) throw err;
		this.fd = descriptor;
		this.interval = true;
		this.onOpen();
	}.bind(this));
};

exports.class.prototype.shift = function(callback){
	if (this.buffer.length == 0) {
		if (this.interval) {
			// fill the queue
			this.read(function(){
				this.shift(callback);
			}.bind(this));
		} else {
			callback(false);
		}
		return;
	}
	var line = this.buffer.shift();
	callback(line);
};

exports.class.prototype.read = function(callback){
	if (typeof(this.fd) == 'undefined') {
		this.afterOpen.push(function(){
			this.read(callback);
		}.bind(this));
		return;
	};
	if (callback) this.callbackQueue.push(callback);
	if (this.active) return; else this.active = true;
	fs.read(this.fd, 8096, null, 'iso8859-1', this.processFileInput.bind(this));
};

exports.class.prototype.processFileInput = function(err, data, bytesRead){
	if (err) throw err;
	// split up into lines
	var lines = (this.buf + data).split('\n');
	// keep the last line for the next processing round because it is not complete without a \n
	if (!(bytesRead < 8096)) this.buf = lines.pop();
	for (var i = 0; i < lines.length - 1; i++) this.processLine(lines[i]);
	this.active = false;
	if (bytesRead < 8096) {
		// if the reader returned less than requested, that means the file is at its end
		//clearInterval(readingInterval);
		this.interval = false;
		fs.close(this.fd, function(){});
	}
	// execute any callbacks that have queued up during the reading activity
	while (this.callbackQueue.length) this.callbackQueue.shift()();
};

exports.class.prototype.processLine = function(line){
	var details = /([0-9]{1,3}.[0-9]{1,3}.[0-9]{1,3}.[0-9]{1,3}) ([^ ]) ([^ ]) \[([0-9]{1,2}\/[a-zA-Z]{3}\/[0-9]{4}:[0-9]{2}:[0-9]{2}:[0-9]{2} \+[0-9]{4})\] "([A-Z]*) ([^ ]*)[^"]*" ([0-9]*) ([0-9]*) "([^"]*)" "([^"]*)"/.exec(line);
	if (details == null) return;
	var date = /([0-9]{1,2})\/([a-zA-Z]{3})\/([0-9]{4}):([0-9]{2}):([0-9]{2}):([0-9]{2}) \+[0-9]{4}/.exec(details[4]);
	var date = new Date(Date.parse(date[1] + ' ' + date[2] + ' ' + date[3] + ' ' + date[4] + ':' + date[5] + ':' + date[6] + ' GMT'));
	if (typeof (this.firstTimestamp) == 'undefined') this.firstTimestamp = date;
	var request = {
		ip : details[1],
		timestamp : date,
		method : details[5],
		url : details[6],
		statusCode : parseInt(details[7]),
		referer : details[9],
		userAgent : details[10]
	};
	try {
		var urlObject = url.parse(request.url);
		request.baseUrl = urlObject.pathname;
		request.params = querystring.parse(urlObject.query);
	} catch (e) {
		sys.puts('unparseable URL: "' + request.url + '"');
	}
	this.buffer.push(request);
};

exports.class.prototype.getFirstTimestamp = function(callback){
	if (typeof(this.firstTimestamp) == 'undefined') {
		this.read(function(){
			callback(this.firstTimestamp);
		}.bind(this));
	} else {
		callback(this.firstTimestamp);
	}
};

exports.class.prototype.onOpen = function()
{
	if (typeof(this.afterOpen) == 'undefined') return;
	while (this.afterOpen.length) this.afterOpen.shift()();
};
