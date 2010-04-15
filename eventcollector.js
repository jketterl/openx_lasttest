function EventCollector(config) {
    this.config = config;
    this.expectedEvents = config.expectedEvents || [];
    var c = this;
    this.collectEvent = function(event){
        for (var i in c.expectedEvents) {
            var e = c.expectedEvents[i];
            if (e.target == event.target && e.type == event.type) {
                c.expectedEvents.splice(i, 1);
            }
        }
        if (c.expectedEvents.length == 0 && c.config.callback) {
            c.config.callback();
        }
    };
};

EventCollector.prototype.setEvents = function(expectedEvents) {
    this.expectedEvents = expectedEvents;
};

EventCollector.prototype.addEvent = function(event) {
    this.expectedEvents.push(event);
};

module.exports = EventCollector;