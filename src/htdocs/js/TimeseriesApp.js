/* global OffCanvas */
'use strict';


var Collection = require('mvc/Collection'),
    Model = require('mvc/Model'),
    View = require('mvc/View'),
    Util = require('util/Util'),

    ObservatoryFactory = require('ObservatoryFactory'),
    TimeseriesCollectionView = require('TimeseriesCollectionView'),
    TimeseriesFactory = require('TimeseriesFactory'),
    TimeseriesSelectView = require('TimeseriesSelectView');


/**
 * Round a date up to the next N minute interval.
 *
 * @param dt {Date}
 *        date to round.
 * @param n {Integer}
 *        default 5.
 *        number of minutes to round to.
 *        e.g. 1: round up to nearest minute.
 *             5: round up to nearest 5 minutes.
 * @return {Date} rounded date.
 *         If dt is on a 5 minute interval, the return value is 5 minutes later.
 */
var __roundUpToNearestNMinutes = function (dt, n) {
  var y = dt.getUTCFullYear(),
      m = dt.getUTCMonth(),
      d = dt.getUTCDate(),
      h = dt.getUTCHours(),
      i = dt.getUTCMinutes();

  n = n || 5;
  // round i
  i = n * Math.floor((i + n) / n);
  return new Date(Date.UTC(y, m, d, h, i));
};

/**
 * Format a date object.
 *
 * @param d {Date}
 *        date to format.
 */
var __formatDate = function (d) {
  if (!d || typeof d.toISOString !== 'function') {
    return '';
  }
  return d.toISOString().replace('T', ' ').replace(/\.[\d]{3}Z/, '');
};


/**
 * Timeseries application.
 *
 * @param options {Object}
 *        all options are passed to View.
 * @param options.channels {Array}
 *        channels to display, passed to ChannelSelectView.
 * @param options.config {Model}
 *        configuration options.
 * @param options.configEl {DOMElement}
 *        optional, new element is inserted into options.el by default.
 *        element for TimeseriesSelectView.
 * @param observatories {Collection}
 *        default Collection().
 *        collection of observatories for reference.
 * @param observatoryFactory {ObservatoryFactory}
 *        default ObservatoryFactory().
 *        observatory factory used to populate observatories collection,
 *        if collection is not configured.
 * @param options.timeseries {Array<Timeseries>}
 *        timeseries to display.
 */
var TimeseriesApp = function (options) {
  var _this,
      _initialize,
      // variables
      _autoUpdateTimeout,
      _channels,
      _config,
      _configView,
      _descriptionEl,
      _observatories,
      _timeseriesEl,
      _timeseries,
      _timeseriesFactory,
      _timeseriesView,
      // methods
      _onAutoUpdate,
      _onConfigChange,
      _onTimeseriesError,
      _onTimeseriesLoad,
      _updateDescription;

  _this = View(options);

  _initialize = function (options) {
    var configEl = options.configEl,
        el = _this.el,
        observatoryFactory,
        viewEl;

    _channels = options.channels || ['H', 'E', 'Z', 'F'];

    el.classList.add('timeseries-app');
    el.innerHTML =
        '<div class="description"></div>' +
        '<div class="view"></div>' +
        '<div class="load">' +
          '<div class="load-mask"></div>' +
          '<span class="load-text">LOADING</span>' +
        '</div>';

    if (!configEl) {
      el.insertAdjacentHTML('<div class="config"></div>', 'afterbegin');
      configEl = el.querySelector('.config');
    }

    _descriptionEl = el.querySelector('.description');
    viewEl = el.querySelector('.view');

    _config = Model(Util.extend({
      channel: 'H',
      endtime: null,
      observatory: null,
      starttime: null,
      timemode: 'pasthour'
    }, options.config));
    _config.on('change', _onConfigChange);

    _observatories = options.observatories || null;
    if (_observatories === null) {
      _observatories = Collection();
      observatoryFactory = options.observatoryFactory || ObservatoryFactory();
      observatoryFactory.getObservatories({
        callback: function (observatories) {
          _observatories.reset(observatories);
        }
      });
    }
    _observatories.on('reset', _updateDescription);

    _timeseries = options.timeseries || Collection();

    _timeseriesFactory = TimeseriesFactory({
      observatories: _observatories
    });

    _configView = TimeseriesSelectView({
      el: configEl,
      channels: _channels,
      config: _config
    });

    _timeseriesView = TimeseriesCollectionView({
      el: viewEl,
      collection: _timeseries
    });
    _timeseriesEl = el;
    _onConfigChange();
  };

  /**
   * Auto update displayed data.
   */
  _onAutoUpdate = function () {
    _onConfigChange();
  };

  /**
   * Configuration model "change" listener.
   */
  _onConfigChange = function () {
    var channel,
        channels,
        endtime,
        seconds,
        observatory,
        starttime,
        timemode,
        autoUpdateTime = null;

    if (typeof OffCanvas === 'object') {
      // hide offcanvas
      OffCanvas.getOffCanvas().hide();
    }

    if (_autoUpdateTimeout !== null) {
      clearTimeout(_autoUpdateTimeout);
      _autoUpdateTimeout = null;
    }

    channel = _config.get('channel');
    observatory = _config.get('observatory');
    timemode = _config.get('timemode');
    if (timemode === 'realtime') {
      // 15 minutes
      endtime = __roundUpToNearestNMinutes(new Date(), 1);
      starttime = new Date(endtime.getTime() - 900000);
      autoUpdateTime = 300000;
    } else if (timemode === 'pastday') {
      endtime = __roundUpToNearestNMinutes(new Date(), 5);
      starttime = new Date(endtime.getTime() - 86400000);
      autoUpdateTime = 300000;
    } else {
      endtime = _config.get('endtime');
      starttime = _config.get('starttime');
    }
    if ((endtime.getTime() - starttime.getTime()) <= 1800000) {
      seconds = true;
    } else {
      seconds = false;
    }

    _timeseriesEl.classList.add('loading');

    if (observatory !== null) {
      channels = _channels;
    } else {
      channels = null;
    }

    _timeseriesFactory.getTimeseries({
      channel: channel,
      observatory: observatory,
      channels: channels,
      endtime: endtime,
      starttime: starttime,
      callback: _onTimeseriesLoad,
      errback: _onTimeseriesError,
      seconds: seconds
    });

    // schedule auto update
    if (autoUpdateTime !== null) {
      _autoUpdateTimeout = setTimeout(_onAutoUpdate, autoUpdateTime);
    }
  };

  /**
   * Errback for TimeseriesFactory.
   */
  _onTimeseriesError = function () {
    _timeseriesEl.classList.remove('loading');
    _timeseries.reset([]);
  };

  /**
   * Callback for TimeseriesFactory.
   *
   * @param response {TimeseriesResponse}
   *        timeseries webservice response.
   */
  _onTimeseriesLoad = function (response) {
    var timeseries = response.getTimeseries();
    // copy metadata from observatory to timeseries
    timeseries.forEach(function (t) {
      var metadata = t.get('metadata'),
          observatory = _observatories.get(metadata.observatory);
      if (observatory !== null) {
        Util.extend(metadata, {
          name: observatory.get('name'),
          latitude: observatory.get('latitude'),
          longitude: observatory.get('longitude')
        });
      }
    });
    // sort by latitude
    timeseries.sort(function (a, b) {
      var aMeta = a.get('metadata'),
          bMeta = b.get('metadata'),
          aKey,
          bKey;
      // sort by latitude if available
      aKey = aMeta.latitude;
      bKey = bMeta.latitude;
      if (aKey && bKey) {
        return bKey - aKey;
      }
      // otherwise observatory code
      aKey = aMeta.observatory;
      bKey = bMeta.observatory;
      if (aKey < bKey) {
        return -1;
      } else if (bKey < aKey) {
        return 1;
      }
      return 0;
    });
    // update collection
    _timeseries.reset(timeseries);
    _updateDescription();
    // done loading
    _timeseriesEl.classList.remove('loading');
  };

  /**
   * Update description of data being shown.
   */
  _updateDescription = function () {
    var channel = _config.get('channel'),
        description,
        endtime = _config.get('endtime'),
        obs,
        observatory = _config.get('observatory'),
        starttime = _config.get('starttime'),
        timeDescription,
        timemode = _config.get('timemode'),
        title;

    if (observatory !== null) {
      title = observatory;
      description = 'all observatory channels';
      // try to load observatory name, collection may not be loaded yet
      obs = _observatories.get(observatory);
      if (obs !== null) {
        title = title + ' ' + obs.get('name');
      }
      title = title + ' Observatory';
    } else if (channel !== null) {
      title = channel + ' Channel';
      description = 'all observatories with this channel.';
    }

    if (timemode === 'realtime') {
      timeDescription = 'Past 15 Minutes';
    } else if (timemode === 'pastday') {
      timeDescription = 'Past day';
    } else { // custom
      timeDescription = __formatDate(starttime) + ' - ' + __formatDate(endtime);
    }

    _descriptionEl.innerHTML = '<h2>' + title + '</h2>' +
        '<p>' + timeDescription + ', ' + description + '</p>';
  };

  /**
   * Destroy this application.
   */
  _this.destroy = Util.compose(function () {
    _config.off('change', _onConfigChange);
    _configView.destroy();
    _timeseriesView.destroy();

    _observatories.off('reset', _updateDescription);

    _config = null;
    _configView = null;
    _descriptionEl = null;
    _observatories = null;
    _timeseries = null;
    _timeseriesEl = null;
    _timeseriesFactory = null;
    _timeseriesView = null;
  }, _this.destroy);


  _initialize(options);
  options = null;
  return _this;
};


module.exports = TimeseriesApp;
