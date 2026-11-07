//+------------------------------------------------------------------+
//| Scalp_Ribbon_MT5.mq5                                              |
//| Screenshot-based reconstruction for MetaTrader 5 desktop.         |
//+------------------------------------------------------------------+
#property version   "1.00"
#property description "Five-EMA ribbon, confirmed BUY/SELL, fixed ATR levels and a six-timeframe trend table."
#property indicator_chart_window
#property indicator_buffers 17
#property indicator_plots   8

#property indicator_type1 DRAW_FILLING
#property indicator_type2 DRAW_FILLING
#property indicator_type3 DRAW_FILLING
#property indicator_type4 DRAW_COLOR_LINE
#property indicator_type5 DRAW_COLOR_LINE
#property indicator_type6 DRAW_COLOR_LINE
#property indicator_type7 DRAW_COLOR_LINE
#property indicator_type8 DRAW_COLOR_LINE
#property indicator_color1 C'49,53,64',C'49,53,64'
#property indicator_color2 C'28,66,55',C'28,66,55'
#property indicator_color3 C'75,31,48',C'75,31,48'
#property indicator_color4 C'157,163,174',C'46,198,122',C'233,47,83'
#property indicator_color5 C'157,163,174',C'46,198,122',C'233,47,83'
#property indicator_color6 C'157,163,174',C'46,198,122',C'233,47,83'
#property indicator_color7 C'157,163,174',C'46,198,122',C'233,47,83'
#property indicator_color8 C'157,163,174',C'46,198,122',C'233,47,83'

input group "Moving average ribbon"
input int FastEMA   = 8;
input int SecondEMA = 13;
input int ThirdEMA  = 21;
input int FourthEMA = 34;
input int SlowEMA   = 55;

input group "Setup levels"
input int    ATRPeriod     = 14;
input double ATRMultiplier = 1.5;
input double TP1_R         = 1.5;
input double TP2_R         = 2.0;
input double TP3_R         = 3.0;

input group "Chart display"
input bool ShowTradeLevels     = true;
input bool ShowTrendTable      = true;
input bool UseScreenshotTheme  = true;
input bool ReserveRightMargin  = true;

enum TrendState
{
   TREND_NEUTRAL = 0,
   TREND_BULLISH = 1,
   TREND_BEARISH = 2
};

const color BullLine = C'46,198,122';
const color BearLine = C'233,47,83';
const color NeutralLine = C'157,163,174';
const color TableBody = C'42,47,59';
const color TableHeader = C'53,58,71';
const color TableBorder = C'72,78,93';

double neutralTop[], neutralBottom[], bullTop[], bullBottom[], bearTop[], bearBottom[];
double ema1[], color1[], ema2[], color2[], ema3[], color3[], ema4[], color4[], ema5[], color5[];
double atr[];
double alpha[5];
int firstValidBar, dashboardBars;
double tickSize;
string prefix;
bool initialized = false;

struct Setup
{
   datetime time;
   TrendState direction;
   double high;
   double low;
   double level[5];
};

Setup trade;
datetime chartBarTime = 0;
datetime lastTradeDrawn = 0;
datetime lastEndDrawn = 0;
bool levelObjectsReady = false;
int chartTrend = -1;
color fillBackground = clrNONE;

string levelNames[5] = {"SL", "ENTRY", "TP1", "TP2", "TP3"};
color levelLines[5] = {C'167,49,75', C'65,101,184', C'46,125,95', C'46,125,95', C'46,125,95'};
color levelBacks[5] = {C'65,28,43', C'26,43,78', C'23,59,48', C'23,59,48', C'23,59,48'};
color levelText[5] = {C'255,122,148', C'146,176,255', C'121,222,171', C'121,222,171', C'121,222,171'};

string tableNames[6] = {"", "15m", "45m", "1h", "4h", "1D"};
// The 45m row uses M15 source data. MT5 has no native M45 timeframe.
ENUM_TIMEFRAMES tableFrames[6] = {PERIOD_CURRENT, PERIOD_M15, PERIOD_M15, PERIOD_H1, PERIOD_H4, PERIOD_D1};
int tableStates[6] = {-1, -1, -1, -1, -1, -1};
datetime tableKeys[6];

ENUM_CHART_PROPERTY_INTEGER themeProperties[] =
{
   CHART_MODE, CHART_SHOW_GRID, CHART_FOREGROUND, CHART_COLOR_BACKGROUND,
   CHART_COLOR_FOREGROUND, CHART_COLOR_CHART_UP, CHART_COLOR_CHART_DOWN,
   CHART_COLOR_CANDLE_BULL, CHART_COLOR_CANDLE_BEAR
};
long themeValues[] =
{
   CHART_CANDLES, false, true, C'22,26,36', C'194,199,211',
   C'15,221,96', C'236,40,56', C'15,221,96', C'236,40,56'
};
long oldTheme[9];
bool themeChanged[9];
bool shiftChanged = false;
bool shiftSizeChanged = false;
double oldShiftSize = 0.0;
const double RightMargin = 29.0;

// Shared by the chart ribbon and every timeframe in the table.
TrendState StackState(const double a, const double b, const double c, const double d, const double e)
{
   if(a > b && b > c && c > d && d > e)
      return TREND_BULLISH;
   if(a < b && b < c && c < d && d < e)
      return TREND_BEARISH;
   return TREND_NEUTRAL;
}

double NextEMA(const double closePrice, const double previous, const double factor)
{
   return previous + factor * (closePrice - previous);
}

double SnapPrice(const double price)
{
   double ticks = price / tickSize;
   // Absorb floating-point noise at an exact half tick.
   return NormalizeDouble(MathRound(ticks + (ticks < 0.0 ? -1e-9 : 1e-9)) * tickSize, _Digits);
}

void BuildLevels(const TrendState direction, const double closePrice, const double atrValue,
                 double &levels[])
{
   double entry = SnapPrice(closePrice);
   double risk = MathMax(1.0, MathCeil(atrValue * ATRMultiplier / tickSize - 1e-9)) * tickSize;
   double side = direction == TREND_BULLISH ? 1.0 : -1.0;
   levels[0] = SnapPrice(entry - side * risk);
   levels[1] = entry;
   levels[2] = SnapPrice(entry + side * risk * TP1_R);
   levels[3] = SnapPrice(entry + side * risk * TP2_R);
   levels[4] = SnapPrice(entry + side * risk * TP3_R);
}

void SaveSetup(const TrendState state, const datetime barTime, const double highPrice,
               const double lowPrice, const double closePrice, const double atrValue)
{
   trade.time = barTime;
   trade.direction = state;
   trade.high = highPrice;
   trade.low = lowPrice;
   BuildLevels(state, closePrice, atrValue, trade.level);
}

color Blend(const color background, const color tint, const double opacity)
{
   uint bg = (uint)background;
   uint fg = (uint)tint;
   double base = 1.0 - opacity;
   uint red   = (uint)MathRound((bg & 255) * base + (fg & 255) * opacity);
   uint green = (uint)MathRound(((bg >> 8) & 255) * base + ((fg >> 8) & 255) * opacity);
   uint blue  = (uint)MathRound(((bg >> 16) & 255) * base + ((fg >> 16) & 255) * opacity);
   return (color)(red | (green << 8) | (blue << 16));
}

void UpdateFillColors()
{
   color background = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   if(background == fillBackground)
      return;
   fillBackground = background;
   color fills[3];
   fills[0] = Blend(background, NeutralLine, 0.20);
   fills[1] = Blend(background, BullLine, 0.23);
   fills[2] = Blend(background, BearLine, 0.25);
   for(int plot = 0; plot < 3; ++plot)
   {
      PlotIndexSetInteger(plot, PLOT_LINE_COLOR, 0, fills[plot]);
      PlotIndexSetInteger(plot, PLOT_LINE_COLOR, 1, fills[plot]);
   }
}

void ApplyChartStyle()
{
   if(UseScreenshotTheme)
   {
      for(int i = 0; i < ArraySize(themeProperties); ++i)
      {
         if(ChartGetInteger(0, themeProperties[i], 0, oldTheme[i]) && oldTheme[i] != themeValues[i])
            themeChanged[i] = ChartSetInteger(0, themeProperties[i], themeValues[i]);
      }
   }
   if(ReserveRightMargin)
   {
      if(!ChartGetInteger(0, CHART_SHIFT))
         shiftChanged = ChartSetInteger(0, CHART_SHIFT, true);
      if(ChartGetDouble(0, CHART_SHIFT_SIZE, 0, oldShiftSize) && MathAbs(oldShiftSize - RightMargin) > 0.001)
         shiftSizeChanged = ChartSetDouble(0, CHART_SHIFT_SIZE, RightMargin);
   }
}

void RestoreChartStyle()
{
   for(int i = 0; i < ArraySize(themeProperties); ++i)
   {
      if(themeChanged[i] && ChartGetInteger(0, themeProperties[i]) == themeValues[i])
         ChartSetInteger(0, themeProperties[i], oldTheme[i]);
   }
   if(shiftSizeChanged && MathAbs(ChartGetDouble(0, CHART_SHIFT_SIZE) - RightMargin) < 0.001)
      ChartSetDouble(0, CHART_SHIFT_SIZE, oldShiftSize);
   if(shiftChanged && ChartGetInteger(0, CHART_SHIFT))
      ChartSetInteger(0, CHART_SHIFT, false);
}

string FrameLabel()
{
   string label = EnumToString(_Period);
   StringReplace(label, "PERIOD_", "");
   if(StringSubstr(label, 0, 1) == "M" && label != "MN1")
      return StringSubstr(label, 1) + "m (chart)";
   if(StringSubstr(label, 0, 1) == "H")
      return StringSubstr(label, 1) + "h (chart)";
   if(label == "D1")
      return "1D (chart)";
   return label + " (chart)";
}

string TrendLabel(const int state)
{
   if(state == TREND_BULLISH) return "Bullish";
   if(state == TREND_BEARISH) return "Bearish";
   if(state == TREND_NEUTRAL) return "Neutral";
   return "Loading";
}

color TrendBackground(const int state)
{
   if(state == TREND_BULLISH) return C'21,125,75';
   if(state == TREND_BEARISH) return C'220,30,62';
   return C'65,72,89';
}

void BaseObject(const string name)
{
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, "\n");
}

void CreateBadge(const string id, const int fontSize = 9)
{
   string box = prefix + id + ".box";
   string text = prefix + id + ".text";
   ObjectCreate(0, box, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   BaseObject(box);
   ObjectSetInteger(0, box, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, box, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, box, OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);

   ObjectCreate(0, text, OBJ_LABEL, 0, 0, 0);
   BaseObject(text);
   ObjectSetInteger(0, text, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, text, OBJPROP_ANCHOR, ANCHOR_CENTER);
   ObjectSetInteger(0, text, OBJPROP_FONTSIZE, fontSize);
   ObjectSetString(0, text, OBJPROP_FONT, "Arial");
   ObjectSetInteger(0, text, OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);
}

void HideBadge(const string id)
{
   ObjectSetInteger(0, prefix + id + ".box", OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);
   ObjectSetInteger(0, prefix + id + ".text", OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);
}

void DrawBadge(const string id, const int x, const int y, const int width, const int height,
               const string caption, const color background, const color foreground, const color border)
{
   string box = prefix + id + ".box";
   string text = prefix + id + ".text";
   ObjectSetInteger(0, box, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, box, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, box, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, box, OBJPROP_YSIZE, height);
   ObjectSetInteger(0, box, OBJPROP_BGCOLOR, background);
   ObjectSetInteger(0, box, OBJPROP_COLOR, border);
   ObjectSetInteger(0, box, OBJPROP_TIMEFRAMES, OBJ_ALL_PERIODS);

   ObjectSetInteger(0, text, OBJPROP_XDISTANCE, x + width / 2);
   ObjectSetInteger(0, text, OBJPROP_YDISTANCE, y + height / 2);
   ObjectSetInteger(0, text, OBJPROP_COLOR, foreground);
   ObjectSetString(0, text, OBJPROP_TEXT, caption);
   ObjectSetInteger(0, text, OBJPROP_TIMEFRAMES, OBJ_ALL_PERIODS);
}

int TrendFromCloses(const double &closes[], const int count)
{
   if(count < SlowEMA)
      return -1;

   double averages[5];
   ArrayInitialize(averages, closes[0]);
   for(int i = 1; i < count; ++i)
      for(int j = 0; j < 5; ++j)
         averages[j] = NextEMA(closes[i], averages[j], alpha[j]);
   return StackState(averages[0], averages[1], averages[2], averages[3], averages[4]);
}

datetime Bucket45(const datetime time)
{
   const int seconds = 45 * 60;
   return (datetime)(((long)time / seconds) * seconds);
}

int GroupClosed45(const MqlRates &rates[], const int count, const datetime activeBucket, double &closes[])
{
   int written = 0;
   // Skip the oldest bucket, which may be truncated at the start of the copy.
   datetime oldest = Bucket45(rates[0].time);
   for(int i = 0; i < count; ++i)
   {
      datetime bucket = Bucket45(rates[i].time);
      if(bucket >= activeBucket)
         break;
      if(bucket != oldest && (i == count - 1 || Bucket45(rates[i + 1].time) != bucket))
         closes[written++] = rates[i].close;
   }
   return written;
}

int Read45Trend(const datetime activeBucket)
{
   MqlRates rates[];
   int copied = CopyRates(_Symbol, PERIOD_M15, 0, 3 * (dashboardBars + 2), rates);
   if(copied <= 0)
      return -1;

   double closes[];
   if(ArrayResize(closes, copied) != copied)
      return -1;
   int count = GroupClosed45(rates, copied, activeBucket, closes);
   return TrendFromCloses(closes, count);
}

void RefreshTrends()
{
   tableStates[0] = chartTrend;
   for(int row = 1; row < 6; ++row)
   {
      ENUM_TIMEFRAMES frame = tableFrames[row];
      datetime key = iTime(_Symbol, frame, 0);
      if(key == 0)
         continue;
      if(row == 2)
         key = Bucket45(key);
      if(tableKeys[row] == key && tableStates[row] >= 0)
         continue;

      int state;
      if(row == 2)
         state = Read45Trend(key);
      else
      {
         double closes[];
         int copied = CopyClose(_Symbol, frame, 1, dashboardBars, closes);
         state = TrendFromCloses(closes, copied);
      }

      tableStates[row] = state;
      if(state >= 0)
         tableKeys[row] = key;
   }
}

void DrawTable(const int x, const int y)
{
   const int tfWidth = 76, stateWidth = 64, rowHeight = 22;
   DrawBadge("header.tf", x, y, tfWidth, rowHeight, "TF", TableHeader, clrWhite, TableBorder);
   DrawBadge("header.ma", x + tfWidth, y, stateWidth, rowHeight, "MA-l" + ShortToString(228) + "ge", TableHeader, clrWhite, TableBorder);

   for(int row = 0; row < 6; ++row)
   {
      int top = y + (row + 1) * rowHeight;
      string key = IntegerToString(row);
      DrawBadge("tf" + key, x, top, tfWidth, rowHeight, tableNames[row], TableBody, clrWhite, TableBorder);
      color fill = TrendBackground(tableStates[row]);
      DrawBadge("ma" + key, x + tfWidth, top, stateWidth, rowHeight,
                TrendLabel(tableStates[row]), fill, clrWhite, TableBorder);
   }
}

void SyncLevelLines()
{
   if(!ShowTradeLevels)
      return;
   if(trade.time == 0 || chartBarTime <= trade.time)
   {
      if(levelObjectsReady)
         for(int i = 0; i < 5; ++i)
            ObjectSetInteger(0, prefix + "line" + IntegerToString(i), OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);
      lastTradeDrawn = 0;
      lastEndDrawn = 0;
      return;
   }
   if(trade.time == lastTradeDrawn && chartBarTime == lastEndDrawn)
      return;

   for(int i = 0; i < 5; ++i)
   {
      string name = prefix + "line" + IntegerToString(i);
      if(!levelObjectsReady)
      {
         ObjectCreate(0, name, OBJ_TREND, 0, trade.time, trade.level[i], chartBarTime, trade.level[i]);
         BaseObject(name);
         ObjectSetInteger(0, name, OBJPROP_RAY_LEFT, false);
         ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
         ObjectSetInteger(0, name, OBJPROP_COLOR, levelLines[i]);
         ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
      }
      else
      {
         ObjectMove(0, name, 0, trade.time, trade.level[i]);
         ObjectMove(0, name, 1, chartBarTime, trade.level[i]);
      }
      ObjectSetInteger(0, name, OBJPROP_TIMEFRAMES, OBJ_ALL_PERIODS);
   }
   levelObjectsReady = true;
   lastTradeDrawn = trade.time;
   lastEndDrawn = chartBarTime;
}

void DrawSignalBadge(const int width, const int height)
{
   int x, y;
   bool sell = trade.direction == TREND_BEARISH;
   if(trade.time > 0 && ChartTimePriceToXY(0, 0, trade.time, sell ? trade.high : trade.low, x, y))
   {
      int top = sell ? y - 28 : y + 7;
      if(x >= 23 && x < width - 85 && top >= 0 && top + 20 < height)
      {
         color fill = sell ? C'222,30,66' : C'22,151,85';
         DrawBadge("signal", x - 23, top, 46, 20, sell ? "SELL" : "BUY", fill, clrWhite, fill);
         return;
      }
   }
   HideBadge("signal");
}

void PlaceOverlays()
{
   int width = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int height = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   if(width <= 0 || height <= 0)
      return;

   const int tableWidth = 140, tableHeight = 154, badgeWidth = 113, badgeHeight = 21;
   const int rightInset = 61;
   int tableX = (int)MathMax(0, width - rightInset - tableWidth);
   int tableY = (int)MathMax(0, (height - tableHeight) / 2);
   if(ShowTradeLevels)
   {
      DrawSignalBadge(width, height);
      for(int i = 0; i < 5; ++i)
      {
         int x, y;
         string id = "level" + IntegerToString(i);
         if(trade.time == 0 || chartBarTime <= trade.time ||
            !ChartTimePriceToXY(0, 0, chartBarTime, trade.level[i], x, y) ||
            x < 0 || x >= width - rightInset || y < badgeHeight / 2 || y >= height - badgeHeight / 2)
         {
            HideBadge(id);
            continue;
         }

         int left = (int)MathMax(0, MathMin(x + 9, width - rightInset - badgeWidth));
         int top = y - badgeHeight / 2;
         if(ShowTrendTable && left + badgeWidth + 4 > tableX &&
            top < tableY + tableHeight && top + badgeHeight > tableY)
            left = (int)MathMax(0, tableX - badgeWidth - 4);

         DrawBadge(id, left, top, badgeWidth, badgeHeight,
                   levelNames[i] + "  " + DoubleToString(trade.level[i], _Digits),
                   levelBacks[i], levelText[i], levelLines[i]);
      }
   }
   if(ShowTrendTable)
      DrawTable(tableX, tableY);
   ChartRedraw();
}

int OnInit()
{
   if(FastEMA < 1 || FastEMA >= SecondEMA || SecondEMA >= ThirdEMA || ThirdEMA >= FourthEMA ||
      FourthEMA >= SlowEMA || SlowEMA > 500 || ATRPeriod < 1 || ATRPeriod > 500 ||
      !MathIsValidNumber(ATRMultiplier) || ATRMultiplier <= 0.0 ||
      !MathIsValidNumber(TP1_R) || !MathIsValidNumber(TP2_R) || !MathIsValidNumber(TP3_R) ||
      TP1_R <= 0.0 || TP1_R >= TP2_R || TP2_R >= TP3_R)
   {
      Print("Scalp Ribbon: use increasing EMA periods and TP multiples, with positive ATR settings.");
      return INIT_PARAMETERS_INCORRECT;
   }

   tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0)
      tickSize = _Point;
   if(tickSize <= 0.0)
      return INIT_FAILED;

   alpha[0] = 2.0 / (FastEMA + 1.0);
   alpha[1] = 2.0 / (SecondEMA + 1.0);
   alpha[2] = 2.0 / (ThirdEMA + 1.0);
   alpha[3] = 2.0 / (FourthEMA + 1.0);
   alpha[4] = 2.0 / (SlowEMA + 1.0);
   firstValidBar = (int)MathMax(SlowEMA - 1, ATRPeriod - 1);
   dashboardBars = SlowEMA * 6;

   SetIndexBuffer(0, neutralTop, INDICATOR_DATA);
   SetIndexBuffer(1, neutralBottom, INDICATOR_DATA);
   SetIndexBuffer(2, bullTop, INDICATOR_DATA);
   SetIndexBuffer(3, bullBottom, INDICATOR_DATA);
   SetIndexBuffer(4, bearTop, INDICATOR_DATA);
   SetIndexBuffer(5, bearBottom, INDICATOR_DATA);
   SetIndexBuffer(6, ema1, INDICATOR_DATA);
   SetIndexBuffer(7, color1, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(8, ema2, INDICATOR_DATA);
   SetIndexBuffer(9, color2, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(10, ema3, INDICATOR_DATA);
   SetIndexBuffer(11, color3, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(12, ema4, INDICATOR_DATA);
   SetIndexBuffer(13, color4, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(14, ema5, INDICATOR_DATA);
   SetIndexBuffer(15, color5, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(16, atr, INDICATOR_CALCULATIONS);

   int periods[5];
   periods[0] = FastEMA;
   periods[1] = SecondEMA;
   periods[2] = ThirdEMA;
   periods[3] = FourthEMA;
   periods[4] = SlowEMA;
   for(int plot = 0; plot < 8; ++plot)
   {
      PlotIndexSetInteger(plot, PLOT_DRAW_BEGIN, SlowEMA - 1);
      if(plot < 3)
         PlotIndexSetInteger(plot, PLOT_SHOW_DATA, false);
      else
      {
         PlotIndexSetInteger(plot, PLOT_LINE_WIDTH, 2);
         PlotIndexSetString(plot, PLOT_LABEL, "EMA " + IntegerToString(periods[plot - 3]));
      }
   }

   IndicatorSetString(INDICATOR_SHORTNAME, "Scalp Ribbon MT5");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   prefix = "SR5." + IntegerToString((long)GetMicrosecondCount()) + ".";
   for(int row = 0; row < 6; ++row)
      tableKeys[row] = 0;
   tableNames[0] = FrameLabel();

   if(ShowTrendTable || ShowTradeLevels)
   {
      if(!EventSetTimer(1))
         return INIT_FAILED;
   }

   ApplyChartStyle();
   UpdateFillColors();
   if(ShowTradeLevels)
   {
      CreateBadge("signal");
      for(int i = 0; i < 5; ++i)
         CreateBadge("level" + IntegerToString(i), 8);
   }
   if(ShowTrendTable)
   {
      CreateBadge("header.tf");
      CreateBadge("header.ma");
      for(int row = 0; row < 6; ++row)
      {
         CreateBadge("tf" + IntegerToString(row), 8);
         CreateBadge("ma" + IntegerToString(row), 8);
      }
   }
   initialized = true;
   ChartRedraw();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(!initialized)
      return;
   ObjectsDeleteAll(0, prefix);
   RestoreChartStyle();
   ChartRedraw();
}

void OnTimer()
{
   if(!initialized)
      return;
   if(ShowTrendTable)
      RefreshTrends();
   PlaceOverlays();
}

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_CHART_CHANGE && initialized)
   {
      UpdateFillColors();
      PlaceOverlays();
   }
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
{
   if(rates_total <= 0)
      return 0;
   ArraySetAsSeries(time, false);
   ArraySetAsSeries(high, false);
   ArraySetAsSeries(low, false);
   ArraySetAsSeries(close, false);

   datetime latest = time[rates_total - 1];
   bool newBar = latest != chartBarTime;
   bool historyRolled = newBar && prev_calculated == rates_total;
   bool reset = prev_calculated <= 0 || prev_calculated > rates_total || historyRolled;
   int start = reset ? 0 : prev_calculated - 1;
   if(reset)
      trade.time = 0;

   for(int i = start; i < rates_total && !IsStopped(); ++i)
   {
      double price = close[i];
      if(i == 0)
      {
         ema1[i] = price;
         ema2[i] = price;
         ema3[i] = price;
         ema4[i] = price;
         ema5[i] = price;
         atr[i] = high[i] - low[i];
      }
      else
      {
         ema1[i] = NextEMA(price, ema1[i - 1], alpha[0]);
         ema2[i] = NextEMA(price, ema2[i - 1], alpha[1]);
         ema3[i] = NextEMA(price, ema3[i - 1], alpha[2]);
         ema4[i] = NextEMA(price, ema4[i - 1], alpha[3]);
         ema5[i] = NextEMA(price, ema5[i - 1], alpha[4]);

         double range = MathMax(high[i] - low[i],
                                MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
         int period = (int)MathMin(i + 1, ATRPeriod);
         atr[i] = atr[i - 1] + (range - atr[i - 1]) / period;
      }

      TrendState state = StackState(ema1[i], ema2[i], ema3[i], ema4[i], ema5[i]);
      color1[i] = state;
      color2[i] = state;
      color3[i] = state;
      color4[i] = state;
      color5[i] = state;

      double top = MathMax(MathMax(ema1[i], ema2[i]), MathMax(MathMax(ema3[i], ema4[i]), ema5[i]));
      double bottom = MathMin(MathMin(ema1[i], ema2[i]), MathMin(MathMin(ema3[i], ema4[i]), ema5[i]));
      neutralTop[i] = state == TREND_NEUTRAL ? top : 0.0;
      neutralBottom[i] = state == TREND_NEUTRAL ? bottom : 0.0;
      bullTop[i] = state == TREND_BULLISH ? top : 0.0;
      bullBottom[i] = state == TREND_BULLISH ? bottom : 0.0;
      bearTop[i] = state == TREND_BEARISH ? top : 0.0;
      bearBottom[i] = state == TREND_BEARISH ? bottom : 0.0;

      // Share the boundary between adjacent fills so the ribbon has no blank segment.
      if(i > SlowEMA - 1 && color5[i - 1] != state)
      {
         if(color5[i - 1] == TREND_NEUTRAL)
         {
            neutralTop[i] = top;
            neutralBottom[i] = bottom;
         }
         else if(color5[i - 1] == TREND_BULLISH)
         {
            bullTop[i] = top;
            bullBottom[i] = bottom;
         }
         else
         {
            bearTop[i] = top;
            bearBottom[i] = bottom;
         }
      }
   }

   if(IsStopped())
      return 0;

   int confirmed = rates_total - 2;
   chartTrend = confirmed >= SlowEMA - 1 ? (int)color5[confirmed] : -1;
   if(ShowTradeLevels)
   {
      int firstCandidate = (int)MathMax(start, firstValidBar + 1);
      for(int i = confirmed; i >= firstCandidate; --i)
      {
         TrendState state = (TrendState)(int)color5[i];
         if(state != TREND_NEUTRAL && state != (TrendState)(int)color5[i - 1] && time[i] > trade.time)
         {
            SaveSetup(state, time[i], high[i], low[i], close[i], atr[i]);
            break;
         }
      }
   }

   chartBarTime = latest;
   if(newBar || reset)
   {
      SyncLevelLines();
      if(ShowTrendTable)
         RefreshTrends();
      PlaceOverlays();
   }
   return rates_total;
}
//+------------------------------------------------------------------+
