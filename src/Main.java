//Ahdil Khan
//Date: June 26th, 2026
//Short Description: This program randomly generates 100 points, 
//each with an x and y coordinate between 0 and 100. No user input is required. 
//The program then sorts and displays the points twice; 
//first in increasing order by x-coordinate, then in increasing order 
//by y-coordinate. If two points share the same x-coordinate, 
//they are sorted by y, and vice versa.


import java.util.Arrays;
import java.util.Comparator;

public class Main {
    public static void main(String[] args) {
        Point[] points = new Point[100];
        for (int i = 0; i < 100; i++) {
            points[i] = new Point(Math.random() * 100, Math.random() * 100);
        }

        Arrays.sort(points);
        System.out.println("Points sorted on x-coordinates");
        for (int i = 0; i < points.length; i++) {
            System.out.println(points[i]);
        }

        Arrays.sort(points, new CompareY());
        System.out.println("Points sorted on y-coordinates");
        for (int i = 0; i < points.length; i++) {
            System.out.println(points[i]);
        }
    }
}

class Point implements Comparable<Point> {
    double x;
    double y;

    public Point(double x, double y) {
        this.x = x;
        this.y = y;
    }

    public String toString() {
        return "(" + x + ", " + y + ")";
    }

    public int compareTo(Point otherPoint) {
        if (this.x > otherPoint.x) {
            return 1;
        } else if (this.x < otherPoint.x) {
            return -1;
        } else {
            if (this.y > otherPoint.y) {
                return 1;
            } else if (this.y < otherPoint.y) {
                return -1;
            } else {
                return 0;
            }
        }
    }
}

class CompareY implements Comparator<Point> {
    public int compare(Point point1, Point point2) {
        if (point1.y > point2.y) {
            return 1;
        } else if (point1.y < point2.y) {
            return -1;
        } else {
            if (point1.x > point2.x) {
                return 1;
            } else if (point1.x < point2.x) {
                return -1;
            } else {
                return 0;
            }
        }
    }
}