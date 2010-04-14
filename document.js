exports.delivered = false;
exports.reset = function(){
	this.delivered = false;
};
exports.write = function(){
	var data = Array.prototype.join.apply(arguments);
	this.delivered = (data != '');
};
