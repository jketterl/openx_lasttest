var sys = require('sys');
var fs = require('fs');
var http = require('http');
var url = require('url');
var querystring = require('querystring');
var document = require('./document');
var LogReader = require('./logreader');
var EventCollector = require('./eventcollector');

var timeDelta = null;
var startTime = new Date();

// remove first two arguments, since those will always be "node" and "replayer.js"
var args = process.argv.slice(2);

// check arguments
if (args.length < 2) {
	sys.puts('missing arguments');
	process.exit(1);
}

// parse arguments
var servername = args.shift();
var filenames = [];
while (args.length) filenames.push(args.shift());

var clientNum = 0;

var getClient = function(reader){
	var client = http.createClient(80, servername);
	client.id = clientNum++;
	client.reader = reader;
	sys.puts(new Date() + ' handing out client id: ' + client.id);
	client.addListener('timeout', function(){
		var cClient = client;
		return function(){
			if (cClient.timedOut) return; else cClient.timedOut = true;
			sys.puts('http client timeout on id: ' + cClient.id);
			sys.puts(new Date() - cClient.timeoutStarted);
			doRequest(getClient(cClient.reader), cClient.request);
			//cClient.destroy();
		};
	}());
	client.addListener('error', function(){
		var cClient = client;
		return function(err){
			if (cClient.hasError) return; else cClient.hasError = true;
			if (cClient.timedOut) return;
			sys.puts(new Date() + ' Error "' + err.message + '" on client id: ' + cClient.id);
			if (typeof(err) != 'object') return;
			switch (err.message) {
				case 'EHOSTUNREACH, No route to host':
					setTimeout(function(){
						var ccClient = cClient;
						return function(){
							doRequest(getClient(ccClient.reader), ccClient.request);
						};
					}(), 1000);
					//cClient.destroy();
					break;
				case 'Parse Error':
				case 'EINVAL, Invalid argument':
					stats.unParsed++;
					process.nextTick(function(){
						startRequestSpooling(getClient(cClient.reader));
					});
					//cClient.destroy();
					break;
				default: throw err;
			}
		};
	}());
	return client;
};

var lastReadTimestamp;
var lastExecutedTimestamp;

var stats = {
	urls:0,
	called:0,
	delivered:0,
	unExpectedErrors:0,
	unExpectedSuccesses:0,
	unParsed:0,
	timed:[]
};

Function.prototype.bind = function(obj){
	var method = this;
	return function(){
		return method.apply(obj || window, arguments);
	};
};

var earliestTimestamp = new Date();

var collector = new EventCollector({
	callback:function(){
		timeDelta = new Date() - earliestTimestamp;
		// for every reader...
		for (var i = 0; i < readers.length; i++) {
			// start k threads
			for (var k = 0; k < 5; k++) {
				startRequestSpooling(getClient(readers[i]), readers[i]);
			}
		}
		var statsInterval = setInterval(function(){
			var calls = 0; var delivered = 0;
			if (stats.timed.length) {
				while (stats.timed[0].timestamp < lastReadTimestamp - 3600000) stats.timed.shift();
				for (var i = 0; i < stats.timed.length; i++) {
					calls++;
					if (stats.timed[i].success) delivered++;
				}
			}
			var now = new Date();
			var simTime = new Date(now - timeDelta);
			sys.print('simTime: ' + simTime + '; ');
			sys.print('lag: ' + Math.round((simTime - lastExecutedTimestamp) / 1000) + 's; ');
			sys.print('pace: ' + Math.round(stats.urls / (now - startTime) * 10000) / 10 + '/s; ');
			sys.print('unparsed: ' + stats.unParsed + '; ');
			sys.print('!XE: ' + stats.unExpectedErrors + '; !XS: ' + stats.unExpectedSuccesses + '; ');
			sys.print('calls: ' + stats.called + '; delivered: ' + stats.delivered + ' (' + (Math.round(stats.delivered / stats.called * 1000) / 10) + '%); ');
			sys.print('1h: ' + (Math.round(delivered / calls * 1000) / 10) + '%');
			sys.print('    \r');
		}, 100);
	}
});

var readers = [];

for (var i = 0; i < filenames.length; i++) {
	var reader = new LogReader(filenames[i]);
	readers.push(reader);
	var event = {
		target:reader,
		type:'firstTimestamp'
	};
	collector.addEvent(event);
	reader.getFirstTimestamp(function(){
		var myEvent = event;
		return function(timestamp){
			sys.puts(myEvent.target.filename + ' starts: ' + timestamp);
			if (timestamp < earliestTimestamp) earliestTimestamp = timestamp;
			collector.collectEvent(myEvent);
		};
	}());
}

var startRequestSpooling = function(client) {
	// pull a request from the queue
	client.reader.shift(function(request){
		// if the reader returns false, it doesn't have anything more on the log... let this "thread" die.
		if (!request) return;
		// calculate whether the request is already due or is still in the future
		var lag = request.timestamp - (new Date() - timeDelta);
		if (lag > 0) {
			// next event is still in the future, set timeout
			setTimeout(function(){
				doRequest(client, request);
			}, lag);
		} else {
			// next event is now or in the past, execute it now
			doRequest(client, request);
		}
	});
};

var isSuccess = function(responseCode){
	return responseCode == 200;
};

var doRequest = function(client, request) {
	if (client.timedOut || client.hasError) return;
	client.current = request;
	var httpRequest = client.request(request.method, request.url, {
		host: servername,
		referer: request.referer,
		'User-Agent': request.userAgent
	});
	httpRequest.addListener('response', function(response){
		if (response.client.timedOut || response.client.hasError) return;
		clearTimeout(response.client.timeout);
		if (isSuccess(response.statusCode) && !isSuccess(request.statusCode)) stats.unExpectedSuccesses++;
		if (!isSuccess(response.statusCode) && isSuccess(request.statusCode)) stats.unExpectedErrors++;
		stats.urls++;
		var body = '';
		response.addListener('data', function(data){
			body += data;
		});
		response.addListener('end', function(){
			if (typeof(request.baseUrl) == 'undefined' || typeof(request.params) == 'undefined') {
				stats.unParsed++;
				return;
			}
			try {
				switch (request.baseUrl) {
					case '/www/delivery/ajs.php':
						stats.called++;
						var statsObject = {
							timestamp:request.timestamp,
							success:false
						};
						document.reset();
						eval(body);
						if (document.delivered) {
							stats.delivered++;
							statsObject.success = true;
						}
						stats.timed.push(statsObject);
						break;
					case '/www/delivery/spc.php':
						OA_output = [];
						eval(body);
						var zones = request.params.zones.split('|');
						for (var i = 0; i < zones.length; i++) {
							var statsObject = {
								timestamp:request.timestamp,
								success:false
							};
							stats.called++;
							var split = zones[i].split('=');
							if (typeof(OA_output[split[0]]) != 'undefined' && OA_output[split[0]] != '') {
								stats.delivered++;
								statsObject.success = true;
							}
							stats.timed.push(statsObject);
						}
						break;
				}
			} catch (e) {
				stats.unParsed++;
			}
		});
		process.nextTick(function(){
			var client = response.client;
			return function(){
				startRequestSpooling(client);
			};
		}());
	});
	httpRequest.end();
	client.setTimeout(10000);
	client.timeout = setTimeout(function(){
		sys.puts('timeout on client id ' + client.id);
		client.timedOut = true;
		process.nextTick(function(){
			doRequest(getClient(client.reader), client.current);
		});
	}, 10000);
	lastExecutedTimestamp = request.timestamp;
};

process.addListener('SIGINT', function(){
	sys.puts('');
	process.exit(0);
});
