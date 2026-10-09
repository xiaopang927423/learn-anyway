import Foundation
import CoreGraphics
var box = CGRect(x: 0, y: 0, width: 22, height: 16)
let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let context = CGContext(url, mediaBox: &box, nil)!
context.beginPDFPage(nil)
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.addPath(CGPath(roundedRect: CGRect(x: 1, y: 1, width: 20, height: 14), cornerWidth: 3, cornerHeight: 3, transform: nil))
context.fillPath()
context.setStrokeColor(CGColor(gray: 1, alpha: 1))
context.setLineWidth(1.8)
context.move(to: CGPoint(x: 5, y: 12))
for p in [CGPoint(x: 8,y: 4),CGPoint(x: 11,y: 10),CGPoint(x: 14,y: 4),CGPoint(x: 17,y: 12)] {context.addLine(to: p)}
context.strokePath()
context.endPDFPage()
context.closePDF()
