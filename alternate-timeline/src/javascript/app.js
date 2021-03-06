Ext.define("TSAlternateTimeline", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    layout: 'border',
    
    mixins: [
        'Rally.Messageable'
    ], 
    
    items: [
        {xtype:'container', itemId:'selector_box', region: 'north' },
        {xtype:'container',itemId:'display_box',layout:'border', region:'center'}
    ],

    integrationHeaders : {
        name : "TSAlternateTimeline"
    },

    config: {
        defaultSettings: {
            milestone_display_count: 7,
            showScopeSelector:  true,
            plannedEndField  : 'c_PlannedEndDate',
            plannedStartField: 'c_PlannedStartDate',
            actualStartField : 'c_ActualStartDate',
            actualEndField   : 'c_ActualEndDate'
        }
    },
                        
    launch: function() {
        var show_filter = this.getSetting('showScopeSelector');
        var selector_box = this.down('#selector_box');
        selector_box.removeAll();
        
        if ( show_filter == true || show_filter == "true" ) {
            this._addSelector(selector_box);
            this.subscribe(this,'requestMilestoneFilter',this._publishFilter,this);
        } else {
            this.subscribe(this,'milestoneFilterChanged', this._receiveFilterChange, this);
            this.publish('requestMilestoneFilter',this);
        }
    },
    
    _addSelector: function(selector_box) {
        selector_box.add({
            xtype: 'rallycustomfilterbutton',
            modelNames: ['Milestone'],
            context: this.context,
            listeners: {
                customfilter: {
                    fn: function(button, configuration) {
                        this.publish('milestoneFilterChanged', configuration.filters);
                        this.filter = configuration.filters;
                        this._updateData();
                    },
                    single: false,
                    scope: this
                }
            }
        });
    },
    
    _receiveFilterChange: function(input) {
        this.logger.log('Received filter change:', input);
        this.filter = input;
        this._updateData();
    },

    _publishFilter: function() {
        var button = this.down('rallycustomfilterbutton');
        this.publish('milestoneFilterChanged', button && button.getQuery());
    },
    
    _getFilters: function() {
        this.logger.log('_getFilters:', this.filter.toString());

        //var filters = this.filter;

        var andFilters = Ext.create('Rally.data.wsapi.Filter',{
            property: 'Projects',
            operator: 'contains',
            value: this.getContext().getProject()._ref
        });

        andFilters = andFilters.or({
            property: 'TargetProject',
            value: null
        });

        

        if ( Ext.isEmpty(this.filter) || this.filter.length === 0) {
            if ( Ext.isEmpty(this.chartStartDate) ) {
                return andFilters.and(Ext.create('Rally.data.wsapi.Filter', {
                                        property: this.getSetting('plannedEndField'),
                                        operator: '>',
                                        value: '2015-12-31'
                                    }));
            } else {
                return andFilters.and(Ext.create('Rally.data.wsapi.Filter', {
                                        property: this.getSetting('plannedEndField'),
                                        operator: '>=',
                                        value: Rally.util.DateTime.toIsoString(this.chartStartDate)
                                    }));
            }
        }

            return andFilters.and(Ext.create('Rally.data.wsapi.Filter', {
                                        property: this.filter[0].property,
                                        operator: this.filter[0].operator,
                                        value: this.filter[0].value
                                    }));
        
    },
    
    _updateData: function() {
        var display_box = this.down('#display_box'),
            me = this;

        this.chartStartDate = new Date(2015,10,1);
            
        display_box.removeAll();
        
        Deft.Chain.pipeline([
            this._loadMilestones,
            this._processMilestones
        ],this).then({
            success: function(data) {
                me._addTimeline(display_box);
            },
            failure: function(msg) {
                Ext.Msg.alert("Problem loading data", msg);
            }
        });
    },
    
    _loadMilestones: function() {
        this.setLoading('Gathering milestones...');
        
        var config = {
            model: 'Milestone',
            fetch: ['FormattedID','Name','TargetDate', 
                this.getSetting('plannedEndField'), this.getSetting('plannedStartField'),
                this.getSetting('actualStartField'), this.getSetting('actualEndField')],
            filters: this._getFilters(),
            sorters: [{property:this.getSetting('plannedEndField'),direction:'ASC'}]
        };
        
        return this._loadWsapiRecords(config);
    },
    
    _processMilestones: function(milestones) {
        this.setLoading('Process milestones...');
        this.logger.log('_processMilestones',milestones);
        
        this.dateCategories = this._getDateCategories();
        
        this.milestoneCategories = Ext.Array.map(milestones, function(milestone) { 
            return Ext.String.format( '{0}: {1}',
                milestone.get('FormattedID'),
                milestone.get('Name')
            );
        });
                
        var planned_series = { 
            name: 'Planned',
            data: this._getPlannedRangesFromMilestones(milestones,this.dateCategories)
        };
        
        var actual_series = {
            name: 'Actual',
            data: this._getActualRangesFromMilestones(milestones, this.dateCategories)
        };
        
        this.milestoneSeries = [
            actual_series,
            planned_series
        ];
    },
    
    _getDateCategories: function() {
        var start_date = this.chartStartDate;
        
        return Ext.Array.map( _.range(0,365), function(index) {
            var date = Rally.util.DateTime.add(start_date, 'day', index);
            return this._getCategoryFromDate(date);
        },this);
    },
   
    _getCategoryFromDate: function(date) {
        return Ext.Date.format(date, 'Y-m-d');
    },
    
    _getPositionOnTimeline: function(categories, date) {
        var category_date = this._getCategoryFromDate(date);
        console.log(category_date, date);
        
        var index = Ext.Array.indexOf(categories,category_date);
        
        if ( index > -1 ) { return index; }
        
        if (category_date > categories[categories.length-1] ) { return categories.length-1; }
        
        return 0;
    },
    
    _getPlannedRangesFromMilestones: function(milestones, categories) {
        var plannedStartField = this.getSetting('plannedStartField');
        var plannedEndField   = this.getSetting('plannedEndField');
        
        return Ext.Array.map(milestones, function(milestone) {
            var start_index = this._getPositionOnTimeline(categories, milestone.get(plannedStartField) );
            var end_index   = this._getPositionOnTimeline(categories, milestone.get(plannedEndField) );
            
            return [ start_index, end_index ];
        },this);
    },
    
    _getActualRangesFromMilestones: function(milestones, categories) {
        var actualStartField = this.getSetting('actualStartField');
        var actualEndField = this.getSetting('actualEndField');
        
        return Ext.Array.map(milestones, function(milestone) {
            var start_index = this._getPositionOnTimeline(categories,milestone.get(actualStartField));
            var end_index   = this._getPositionOnTimeline(categories,milestone.get(actualEndField));
            
            console.log('--', milestone.get('Name'), milestone.get(actualStartField), milestone.get(actualEndField), start_index, end_index);
            
            if ( Ext.isEmpty(milestone.get(actualStartField) ) ) {
                start_index = null;
            }
            
            if ( Ext.isEmpty(milestone.get(actualEndField)) ) {
                end_index = this._getPositionOnTimeline(categories,new Date());
            }
            return [ start_index, end_index ];
        },this);
    },
    
    _addTimeline: function(display_box) {
        
        display_box.add({
            xtype:'container',
            region:'west',
            layout: 'vbox',
            items: [
                this._getUpButtonConfig(),
                { xtype:'container', flex: 1 },
                this._getDownButtonConfig()
            ]
        });
                
        display_box.add({
            xtype: 'rallychart',
            region:'center',
           
            loadMask: false,
            chartData: this._getChartData(),
            chartColors: Rally.techservices.Colors.getTimelineColors(),
            chartConfig: this._getChartConfig()
        });

        this.setLoading(false);
    },
    
    _getUpButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'up_button', 
            text: '<span class="icon-up"> </span>', 
            disabled: true, 
            cls: 'secondary small',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollUp(this.highchart);
                    }
                }
            }
        };
    },
    
    _getDownButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'down_button', 
            text: '<span class="icon-down"> </span>', 
            disabled: true, 
            cls: 'secondary small',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollDown(this.highchart);
                    }
                }
            }
        };
    },
            
    /**
     * Generate x axis categories and y axis series data for the chart
     */
    _getChartData: function() {
        return {
            categories: this.milestoneCategories,
            min: 5,
            series: this.milestoneSeries
        };
    },

    _getPlotBands: function() {
        var me = this;
        var start_date = me.chartStartDate;
        var bands = Ext.Array.map( _.range(0,12), function(index) {
            var band_start_date = Rally.util.DateTime.add(start_date, 'month', index);
            var band_end_date = Rally.util.DateTime.add(band_start_date, 'month', 1);
            
            var value = Ext.Date.format(band_start_date,'M');
            
            var to = Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(band_end_date)) - 1;
            if ( to < 0 ) { to = 364; }
            
            return {
                color: '#eee',
                from: Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(band_start_date)) +1,
                to: to,
                label: {
                    text: value,
                    align: 'center',
                    y: -2
                }
            }
        },this);
        
        console.log(bands);
        
        return bands;
    },
    
    _getPlotLines: function() {
        var me = this;
        
        var start_date = me.chartStartDate;
        var month_lines = Ext.Array.map( _.range(0,12), function(index) {
            var date = Rally.util.DateTime.add(start_date, 'month', index);
            var value = Ext.Date.format(date,'z');
            
            return {
                color: '#ccc',
                width: 1,
                value: value
            }
        },this);
        
        var today_line = {
            color: '#c00',
            width: 1,
            value: Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(new Date()))
        };
        
        return Ext.Array.merge( month_lines, today_line );
    },
    
    
    /**
     * Generate a valid Highcharts configuration object to specify the column chart
     */
    _getChartConfig: function() {
        var me = this;
        return {
            chart: {
                inverted: true,
                type: 'columnrange',
                events: {
                    load: function(evt) {
                        me._setChart(this);
                    }
                }
            },
            title: {
                text: ''
            },
            subtitle: {
                text: ''
            },
            xAxis: {
                min: 0,
                id: 'xAxis',
                max: me.getSetting('milestone_display_count')
            },
            yAxis: {
                id: 'yAxis',
                tickInterval: 366,
                categories: this.dateCategories,
                min: 0,
                max: 366,
                title: {
                    text: ' '
                },
                plotBands: this._getPlotBands(),
                plotLines: this._getPlotLines(),
                labels: {
                    align: 'right',
                    formatter: function() {
                        return "";
                    }
                }
            },

            tooltip: {
                headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
                    pointFormat: '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
                    '<td style="padding:0"><b>{point.y:.1f} mm</b></td></tr>',
                    footerFormat: '</table>',
                    shared: true,
                    useHTML: true,
                    enabled: false
            },
            
            legend: { enabled: false },
            
            plotOptions: {

                columnrange: {
                    dataLabels: {
                        enabled: false,
                        formatter: function() { return this.y + "!"; }
                    }
                },
                
                series: {
                    pointPadding: 0
                }
            }
        };
    },
    
    _setChart: function(chart) {
        this.highchart = chart;
        this._enableChartButtons();
    },
    
    _enableChartButtons: function() {
        var up_button = this.down('#up_button');
        var down_button = this.down('#down_button');
        
        up_button.setDisabled(true);
        down_button.setDisabled(true);
        
        if ( this.highchart ) {
            var extremes = this._getExtremes(this.highchart,'xAxis');
            
            if ( extremes.min > 0 ) {
                up_button.setDisabled(false);
            }
            
            if ( extremes.max < extremes.dataMax ) {
                down_button.setDisabled(false);
            }
        }
    },
    
    _getExtremes: function(chart, id) {
        var axis = chart.get(id); // must set the axis' id property
        return axis.getExtremes();
    },
    
    _setExtremes: function(chart, id, min, max) {
        var axis = chart.get(id); // must set the axis' id property
        var extremes = this._getExtremes(chart,id);
        
        axis.setExtremes(min,max);
        this._enableChartButtons();
    },
    
    _scrollUp: function(chart) {
        var extremes = this._getExtremes(chart,'xAxis');
        var new_max = extremes.max - 1;
        var new_min = extremes.min - 1;
        
        if ( new_min < 0 ) { new_min = 0; }
        if ( new_max < new_min + this.getSetting('milestone_display_count') - 1) { 
            new_max = new_min + this.getSetting('milestone_display_count') - 1;
        }
        
        this._setExtremes(chart,'xAxis',new_min,new_max);
    },
    
    _scrollDown: function(chart) {
        var extremes = this._getExtremes(chart,'xAxis');
        var new_max = extremes.max + 1;
        var new_min = extremes.min + 1;
        
        //if ( new_max > extremes.dataMax ) { new_max = extremes.dataMax; }
        if ( new_min > new_max - this.getSetting('milestone_display_count') + 1 ) { 
            new_min =  new_max - this.getSetting('milestone_display_count') + 1;
            if ( new_min < 0 ) { new_min = 0; }
        }
        
        this._setExtremes(chart,'xAxis',new_min,new_max);
    },
      
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID']
        };
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },

    _loadAStoreWithAPromise: function(model_name, model_fields){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("Starting load:",model_name,model_fields);
          
        Ext.create('Rally.data.wsapi.Store', {
            model: model_name,
            fetch: model_fields
        }).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(this);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _displayGrid: function(store,field_names){
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: field_names
        });
    },
    
    getSettingsFields: function() {
        var me = this;

        return [{
            name: 'showScopeSelector',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: 10,
            boxLabel: 'Show Scope Selector<br/><span style="color:#999999;"><i>Tick to use this to broadcast settings.</i></span>'
        },
        {
            name: 'plannedStartField',
            xtype: 'rallyfieldcombobox',
            fieldLabel: 'Planned Start Field',
            labelWidth: 125,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            autoExpand: false,
            alwaysExpanded: false,
            model: 'Milestone',
            listeners: {
                ready: function(field_box) {
                    me._filterOutExceptDates(field_box.getStore());
                }
            },
            readyEvent: 'ready'
        },
        {
            name: 'plannedEndField',
            xtype: 'rallyfieldcombobox',
            fieldLabel: 'Planned End Field',
            labelWidth: 125,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            autoExpand: false,
            alwaysExpanded: false,
            model: 'Milestone',
            listeners: {
                ready: function(field_box) {
                    me._filterOutExceptDates(field_box.getStore());
                }
            },
            readyEvent: 'ready'
        },
        {
            name: 'actualStartField',
            xtype: 'rallyfieldcombobox',
            fieldLabel: 'Actual Start Field',
            labelWidth: 125,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            autoExpand: false,
            alwaysExpanded: false,
            model: 'Milestone',
            listeners: {
                ready: function(field_box) {
                    me._filterOutExceptDates(field_box.getStore());
                }
            },
            readyEvent: 'ready'
        },
        {
            name: 'actualEndField',
            xtype: 'rallyfieldcombobox',
            fieldLabel: 'Actual End Field',
            labelWidth: 125,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10,
            autoExpand: false,
            alwaysExpanded: false,
            model: 'Milestone',
            listeners: {
                ready: function(field_box) {
                    me._filterOutExceptDates(field_box.getStore());
                }
            },
            readyEvent: 'ready'
        }];
    },
    
    _filterOutExceptDates: function(store) {
        var app = Rally.getApp();
        
        store.filter([{
            filterFn:function(field){ 
                var attribute_definition = field.get('fieldDefinition').attributeDefinition;
                var attribute_type = null;
                if ( attribute_definition ) {
                    attribute_type = attribute_definition.AttributeType;
                }
                if ( attribute_type == "DATE") {
                        return true;
                }
                return false;
            } 
        }]);
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
